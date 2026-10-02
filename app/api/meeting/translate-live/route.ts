import { NextRequest, NextResponse } from "next/server";
import { resolveMeetingCallerEmail } from "../_auth";
import { acquireLiveTranslationSlot } from "@/lib/meeting/ai/liveTranslationConcurrency";
import { streamLiveTranslation, streamLiveTranslationBatch } from "@/lib/meeting/ai/liveTranslationStream";

import {
  TRANSLATE_LANGUAGES,
  DEFAULT_TRANSLATE_LANG,
  labelForTranslateLang,
} from "@/lib/meeting/translateLanguages";

const ALLOWED_LANGUAGES = new Map(
  TRANSLATE_LANGUAGES.flatMap((l) => [
    [l.label.toLowerCase(), l.label],
    [l.code.toLowerCase(), l.label],
  ])
);

export const runtime = "nodejs";

// One call translates a single live transcript segment (a sentence or two of
// speech), never a full transcript — cap generously so a client bug can't
// turn this into an unbounded/expensive DeepSeek call.
const MAX_TEXT_LENGTH = 4000;
const MAX_BATCH_SIZE = 4;

/**
 * POST /api/meeting/translate-live
 *
 * Fast live segment translation using Qwen3.6 Flash with Qwen-MT Turbo failover.
 */
export async function POST(req: NextRequest) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    text?: string;
    targetLanguage?: string;
    segments?: Array<{ index?: number; text?: string }>;
  } | null;

  const isBatch = Array.isArray(body?.segments);
  const batch = isBatch
    ? body!.segments!.flatMap((segment) =>
        typeof segment?.index === "number" && typeof segment.text === "string" && segment.text.trim()
          ? [{ index: segment.index, text: segment.text.trim() }]
          : [],
      )
    : [];

  if (isBatch && (batch.length === 0 || batch.length > MAX_BATCH_SIZE)) {
    return NextResponse.json({ error: "Invalid translation batch" }, { status: 400 });
  }
  if (!isBatch && !body?.text?.trim()) {
    return NextResponse.json({ error: "Missing text" }, { status: 400 });
  }
  if (!isBatch && body!.text!.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: "Text too long" }, { status: 413 });
  }
  if (isBatch && batch.reduce((total, segment) => total + segment.text.length, 0) > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: "Translation batch too long" }, { status: 413 });
  }

  const defaultLangLabel = labelForTranslateLang(DEFAULT_TRANSLATE_LANG);
  const rawLang = (body?.targetLanguage || defaultLangLabel).trim().toLowerCase();
  const targetLanguage = ALLOWED_LANGUAGES.get(rawLang);
  if (!targetLanguage) {
    return NextResponse.json({ error: "Invalid targetLanguage" }, { status: 400 });
  }

  const releaseSlot = await acquireLiveTranslationSlot(req.signal);
  if (!releaseSlot) {
    return NextResponse.json(
      { error: "Live translation is busy; retry shortly" },
      { status: 429, headers: { "Retry-After": "1" } },
    );
  }

  try {
    const encoder = new TextEncoder();
    const abortController = new AbortController();
    const requestSignal = AbortSignal.any([req.signal, abortController.signal]);
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (type: string, payload: Record<string, unknown>) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...payload })}\n\n`));
          } catch {
            closed = true;
          }
        };

        void (async () => {
          try {
            if (isBatch) {
              const result = await streamLiveTranslationBatch(batch, targetLanguage, email, requestSignal);
              if (!result) {
                send("error", { error: "Translation upstream failed" });
              } else {
                send("batch-complete", {
                  translations: result.translations,
                  provider: result.provider,
                  elapsedMs: result.elapsedMs,
                  attempts: result.attempts,
                });
              }
            } else {
              const result = await streamLiveTranslation(
                body!.text!,
                targetLanguage,
                email,
                (chunk, provider) => send("chunk", { text: chunk, provider }),
                (provider) => send("reset", { provider }),
                requestSignal,
              );
              if (!result) {
                send("error", { error: "Translation upstream failed" });
              } else {
                send("complete", {
                  translated: result.text,
                  provider: result.provider,
                  elapsedMs: result.elapsedMs,
                  attempts: result.attempts,
                });
              }
            }
          } catch (error) {
            console.error("[meeting] Live translate stream error:", error);
            send("error", { error: "Translation failed" });
          } finally {
            releaseSlot();
            try {
              controller.close();
            } catch {
              closed = true;
            }
          }
        })();
      },
      cancel() {
        closed = true;
        abortController.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    releaseSlot();
    console.error("[meeting] Live translate error:", err);
    return NextResponse.json({ error: "Translation failed" }, { status: 500 });
  }
}
