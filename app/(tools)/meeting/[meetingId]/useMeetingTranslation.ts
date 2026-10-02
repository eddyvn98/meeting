"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MeetingSummary, TranscriptSegment } from "@/lib/meeting/types";
import { DEFAULT_TRANSLATE_LANG, TRANSLATE_LANG_STORAGE_KEY, TRANSLATE_MODE_STORAGE_KEY } from "@/lib/meeting/translateLanguages";
import { buildSummaryTranslationLines, type TranslatedItemFields, type TranslatedSectionFields, type TranslatedSummaryFields } from "@/lib/meeting/translateSummary";
import { joinBilingual } from "@/lib/meeting/bilingualText";
import { isOverviewVisibleKind } from "@/lib/meeting/overviewSections";
import type { TranscriptLanguageMode } from "./components/MeetingTranslationToggle";

interface TranslateResponse {
  segments: { id: string; text: string }[];
  summary: TranslatedSummaryFields | null;
}

/** The source text each translated part was made from, so a section that is
 *  added, filled by AI or edited afterwards is recognised as needing a fresh
 *  translation instead of silently showing its original text. */
interface TranslationSignatures {
  overview: string | null;
  sections: Record<string, string>;
}

const EMPTY_SIGNATURES: TranslationSignatures = { overview: null, sections: {} };

interface CachedTranslation {
  segmentOverrides: Record<string, string>;
  summaryOverride: TranslatedSummaryFields | null;
  signatures: TranslationSignatures;
}

// Module scope, not state — translate() calls the agent (a real, multi-
// second LLM round trip), so switching the target language back and forth
// (or navigating away and back) must not throw away a translation already
// paid for. Keyed by meetingId+targetLang since a translation is only ever
// valid for that specific pair.
const translationCache = new Map<string, CachedTranslation>();
const cacheKey = (meetingId: string, targetLang: string) => `${meetingId}:${targetLang}`;

// Which (meetingId, targetLang) pairs currently have a translate() request
// in flight — module scope for the same reason translationCache is: so
// navigating away from a pair mid-request and back to it later still knows
// a request for it is already running, instead of the pair-change effect
// blindly reporting "not translating" and letting the user fire a second,
// redundant request for the exact same pair.
const inFlightKeys = new Set<string>();

type TranslatedView = "translated" | "bilingual";

/** Bilingual view: original text with the translation on the next line (the
 *  Overview cards render newlines). Falls back to the original when there is
 *  no distinct translation. */
function showBoth(original: string, translated: string | null | undefined, view: TranslatedView): string {
  if (!translated) return original;
  if (view === "translated" || translated === original) return translated;
  return joinBilingual(original, translated);
}

/** Same as showBoth for text that is joined into a sentence (pros/cons). */
function showBothInline(original: string, translated: string, view: TranslatedView): string {
  return view === "bilingual" && translated !== original ? `${original} (${translated})` : translated;
}

/** Merges one section item's translated fields (keyed by item id) onto the
 *  raw, still-untyped item JSON — only the fields present on the translation
 *  (text/task/question/answer/option/pros/cons/label) are overwritten, so
 *  data fields (owner, deadline, done, ids, evidenceSegmentIds, metric
 *  `value`) always pass through untouched regardless of item kind. */
function applyTranslatedItem(item: unknown, byId: Record<string, TranslatedItemFields>, view: TranslatedView): unknown {
  if (!item || typeof item !== "object" || !("id" in item)) return item;
  const record = item as Record<string, unknown>;
  const translated = typeof record.id === "string" ? byId[record.id] : undefined;
  if (!translated) return item;
  const merged: Record<string, unknown> = { ...record };
  for (const [field, value] of Object.entries(translated)) {
    const original = record[field];
    if (typeof value === "string") {
      merged[field] = typeof original === "string" ? showBoth(original, value, view) : value;
    } else if (Array.isArray(value)) {
      merged[field] = Array.isArray(original)
        ? value.map((line, index) => (typeof original[index] === "string" ? showBothInline(original[index], line, view) : line))
        : value;
    }
  }
  return merged;
}

/** Source-text fingerprint of one section's translatable lines. */
function sectionSignature(section: MeetingSummary["sections"][number]): string {
  return buildSummaryTranslationLines({ overview: "", topics: [], sections: [section] }).join("\u0001");
}

function signaturesOf(summary: MeetingSummary): TranslationSignatures {
  return { overview: summary.overview, sections: Object.fromEntries(summary.sections.map((section) => [section.id, sectionSignature(section)])) };
}

// Delta requests already running or already failed for a given (pair, stale
// content) token, so a failure is not retried in a loop.
const deltaInFlight = new Set<string>();
const deltaFailed = new Set<string>();

/**
 * Shared translation state for the Meeting Result page (page.tsx) — lifted
 * out of MeetingTranscriptTab so a single "Translate" action covers both the
 * Transcript tab AND the Overview tab (summary/topics/decisions/action
 * items/blockers/open questions), per the requirement that translating must
 * be complete, not script-only. POST /api/meeting/[meetingId]/translate
 * already translates both in one batched agent call — this hook just owns
 * the resulting client-side state and applies it to `segments`/`summary`.
 */
export function useMeetingTranslation(meetingId: string, segments: TranscriptSegment[], summary: MeetingSummary | null) {
  const [languageMode, setLanguageModeState] = useState<TranscriptLanguageMode>("en");
  const [targetLang, setTargetLangState] = useState<string>(DEFAULT_TRANSLATE_LANG);
  const [segmentOverrides, setSegmentOverrides] = useState<Record<string, string>>({});
  const [summaryOverride, setSummaryOverride] = useState<TranslatedSummaryFields | null>(null);
  const [signatures, setSignatures] = useState<TranslationSignatures>(EMPTY_SIGNATURES);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const liveSeenRef = useRef<Set<string> | null>(null);
  const liveInFlightRef = useRef(new Set<string>());

  // Restore saved preferences on mount to prevent SSR hydration mismatch.
  useEffect(() => {
    try {
      const savedMode = localStorage.getItem(TRANSLATE_MODE_STORAGE_KEY) as TranscriptLanguageMode | null;
      if (savedMode === "en" || savedMode === "vi" || savedMode === "bilingual") {
        setLanguageModeState(savedMode);
      }
      const savedLang = localStorage.getItem(TRANSLATE_LANG_STORAGE_KEY);
      if (savedLang) {
        setTargetLangState(savedLang);
      }
    } catch {}
  }, []);

  // Tracks which (meetingId, targetLang) pair is "current" so an in-flight
  // translate() started for a pair the user has since navigated away from
  // can tell its result is stale and must not apply to whatever pair is
  // showing now (it still writes the shared cache, just not this hook's
  // visible state).
  const currentKeyRef = useRef(cacheKey(meetingId, targetLang));

  // Hydrates from a previous translate() for this exact (meetingId,
  // targetLang) pair, if one exists — covers both switching languages back
  // to one already translated, and the localStorage-restored targetLang
  // above landing after this hook's first render. Also resets translating/
  // translateError, which belong to the previous pair's in-flight request,
  // not this one.
  useEffect(() => {
    currentKeyRef.current = cacheKey(meetingId, targetLang);
    const cached = translationCache.get(currentKeyRef.current);
    setSegmentOverrides(cached?.segmentOverrides ?? {});
    setSummaryOverride(cached?.summaryOverride ?? null);
    setSignatures(cached?.signatures ?? EMPTY_SIGNATURES);
    // Reflect whether THIS pair actually has a request in flight, rather
    // than always false — otherwise navigating away from a pair mid-
    // translate() and back to it before it resolves would report "not
    // translating" and let the user fire a redundant second request for
    // the same pair.
    setTranslating(inFlightKeys.has(currentKeyRef.current));
    setTranslateError(null);
  }, [meetingId, targetLang]);

  useEffect(() => {
    if (liveSeenRef.current === null) {
      liveSeenRef.current = new Set(segments.map((segment) => segment.id));
      return;
    }
    const unseen = segments.filter((segment) => !liveSeenRef.current?.has(segment.id));
    for (const segment of unseen) liveSeenRef.current.add(segment.id);
    if (languageMode === "en" || unseen.length === 0) return;
    for (const segment of unseen) {
      if ((targetLang === DEFAULT_TRANSLATE_LANG && segment.textVi) || !segment.textEn && !segment.textVi) continue;
      const key = `${meetingId}:${targetLang}:${segment.id}`;
      if (liveInFlightRef.current.has(key)) continue;
      liveInFlightRef.current.add(key);
      void fetch("/api/meeting/translate-live", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: segment.textEn ?? segment.textVi, targetLanguage: targetLang }),
      }).then(async (response) => {
        if (!response.ok) return;
        const data = await response.json() as { translated?: string };
        if (!data.translated || currentKeyRef.current !== cacheKey(meetingId, targetLang)) return;
        setSegmentOverrides((previous) => ({ ...previous, [segment.id]: data.translated! }));
        const cache = translationCache.get(currentKeyRef.current) ?? { segmentOverrides: {}, summaryOverride: null, signatures: EMPTY_SIGNATURES };
        translationCache.set(currentKeyRef.current, { ...cache, segmentOverrides: { ...cache.segmentOverrides, [segment.id]: data.translated! } });
      }).catch(() => undefined).finally(() => liveInFlightRef.current.delete(key));
    }
  }, [segments, languageMode, targetLang, meetingId]);

  /** Forgets this session's translation of one segment after its text was corrected. */
  const dropSegmentTranslation = (segmentId: string) => {
    setSegmentOverrides((previous) => {
      const { [segmentId]: _dropped, ...rest } = previous;
      void _dropped;
      return rest;
    });
    const cached = translationCache.get(currentKeyRef.current);
    if (cached) {
      const { [segmentId]: _removed, ...rest } = cached.segmentOverrides;
      void _removed;
      translationCache.set(currentKeyRef.current, { ...cached, segmentOverrides: rest });
    }
  };

  const setTargetLang = (lang: string) => {
    setTargetLangState(lang);
    try {
      localStorage.setItem(TRANSLATE_LANG_STORAGE_KEY, lang);
    } catch {
      // Best-effort — not remembering the pick isn't worth surfacing an error.
    }
  };

  const setLanguageMode = (mode: TranscriptLanguageMode) => {
    setLanguageModeState(mode);
    try {
      localStorage.setItem(TRANSLATE_MODE_STORAGE_KEY, mode);
    } catch {
      // Best-effort — not remembering the pick isn't worth surfacing an error.
    }
  };

  // segment.textVi (from the server) is ONLY ever Vietnamese — real for
  // targetLang "vi", but meaningless for any other target (translate/
  // route.ts only persists "vi"). So a non-"vi" target must show ONLY this
  // session's segmentOverrides, never fall back to the segment's own
  // (Vietnamese) textVi — otherwise a meeting that already has a Vietnamese
  // translation would look "already translated" the moment a different
  // language is picked, hiding the Translate button instead of running it.
  const displaySegments = useMemo(
    () =>
      segments.map((s) => ({
        ...s,
        textVi: targetLang === DEFAULT_TRANSLATE_LANG ? (segmentOverrides[s.id] ?? s.textVi) : (segmentOverrides[s.id] ?? null),
      })),
    [segments, segmentOverrides, targetLang],
  );

  // Bilingual view of the Overview: each text is the original followed by its
  // translation on the next line. Applies onto `sections` (the dynamic
  // overview) rather than the legacy decisions/actionItems/blockers/
  // openQuestions arrays, which the Overview tab no longer reads.
  const displaySummary = useMemo((): MeetingSummary | null => {
    if (!summary) return null;
    if (languageMode === "en" || !summaryOverride) return summary;
    const t = summaryOverride;
    const view: TranslatedView = languageMode === "bilingual" ? "bilingual" : "translated";
    return {
      ...summary,
      overview: showBoth(summary.overview, t.overview, view),
      topics: summary.topics.map((x) => ({ ...x, title: showBoth(x.title, t.topics[x.id], view) })),
      sections: summary.sections.map((section) => {
        const sectionTranslation = t.sections[section.id];
        if (!sectionTranslation) return section;
        return {
          ...section,
          title: showBoth(section.title, sectionTranslation.title, view),
          items: section.items.map((item) => applyTranslatedItem(item, sectionTranslation.items, view)),
        };
      }),
    };
  }, [summary, languageMode, summaryOverride]);

  // Keeps the Overview translated after it changes: a section added by hand,
  // filled by "Generate with AI" or edited has no (or an outdated)
  // translation, so only those sections are sent for translation and merged
  // into the cache. Waits for a first full translation to exist.
  useEffect(() => {
    if (languageMode === "en" || !summary || !summaryOverride || translating) return;
    const staleSections = summary.sections
      .filter((section) => isOverviewVisibleKind(section.kind))
      .map((section) => ({ id: section.id, signature: sectionSignature(section) }))
      .filter((entry) => entry.signature !== "" && entry.signature !== signatures.sections[entry.id]);
    const staleOverview = Boolean(summary.overview) && summary.overview !== signatures.overview;
    if (staleSections.length === 0 && !staleOverview) return;

    const key = cacheKey(meetingId, targetLang);
    const token = `${key}::${staleOverview ? summary.overview : ""}::${staleSections.map((e) => `${e.id}:${e.signature}`).join("|")}`;
    if (deltaInFlight.has(token) || deltaFailed.has(token)) return;
    deltaInFlight.add(token);

    void fetch(`/api/meeting/${meetingId}/translate-sections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetLang, sectionIds: staleSections.map((e) => e.id), overview: staleOverview }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Translate failed (${res.status})`);
        const data = (await res.json()) as { overview: string | null; sections: Record<string, TranslatedSectionFields> };
        const cached = translationCache.get(key);
        if (!cached?.summaryOverride) return;
        const next: CachedTranslation = {
          ...cached,
          summaryOverride: {
            ...cached.summaryOverride,
            overview: data.overview ?? cached.summaryOverride.overview,
            sections: { ...cached.summaryOverride.sections, ...data.sections },
          },
          signatures: {
            overview: staleOverview ? summary.overview : cached.signatures.overview,
            sections: { ...cached.signatures.sections, ...Object.fromEntries(staleSections.map((e) => [e.id, e.signature])) },
          },
        };
        translationCache.set(key, next);
        if (key === currentKeyRef.current) {
          setSummaryOverride(next.summaryOverride);
          setSignatures(next.signatures);
        }
      })
      .catch(() => {
        deltaFailed.add(token);
      })
      .finally(() => {
        deltaInFlight.delete(token);
      });
  }, [languageMode, summary, summaryOverride, signatures, translating, targetLang, meetingId]);

  // A real transcript's translation is allowed to come back with a few gaps
  // (generateTranslations leaves a stray unparseable/skipped line as `null`
  // rather than failing the whole batch — see difyMeetingAgent.ts) — so
  // gating "has this been translated" on EVERY segment having text made the
  // banner below claim "hasn't been generated yet" forever on any meeting
  // long enough to hit a gap, hiding the (correctly rendered, per-row)
  // translation that already exists for the other 90%+ of lines. `hasAny`
  // distinguishes "never translated" from "translated, a few lines missing"
  // so the banner/button below can say which one is true instead of treating
  // both as "not generated".
  const hasAnyTranslation = displaySegments.some((s) => s.textVi) || (summary !== null && summaryOverride !== null);
  const needsTranslation =
    displaySegments.some((s) => !s.textVi) || (summary !== null && languageMode !== "en" && !summaryOverride);

  const translate = async () => {
    if (translating || inFlightKeys.has(cacheKey(meetingId, targetLang))) return;
    const forMeetingId = meetingId;
    const forTargetLang = targetLang;
    const key = cacheKey(forMeetingId, forTargetLang);
    const sourceSignatures = summary ? signaturesOf(summary) : EMPTY_SIGNATURES;
    inFlightKeys.add(key);
    setTranslating(true);
    setTranslateError(null);
    try {
      const res = await fetch(`/api/meeting/${forMeetingId}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLang: forTargetLang }),
      });
      if (!res.ok) throw new Error(`Translate failed (${res.status})`);
      const data = (await res.json()) as TranslateResponse;
      const prevForKey = translationCache.get(key);
      const nextSegmentOverrides = { ...(prevForKey?.segmentOverrides ?? {}) };
      for (const s of data.segments) nextSegmentOverrides[s.id] = s.text;
      const nextSummaryOverride = data.summary ?? prevForKey?.summaryOverride ?? null;
      const nextSignatures = data.summary ? sourceSignatures : (prevForKey?.signatures ?? EMPTY_SIGNATURES);
      translationCache.set(key, {
        segmentOverrides: nextSegmentOverrides,
        summaryOverride: nextSummaryOverride,
        signatures: nextSignatures,
      });
      // The user may have switched to a different meeting/language while
      // this request was in flight — only mirror the result into visible
      // state if this is still the pair being shown.
      if (key === currentKeyRef.current) {
        setSegmentOverrides(nextSegmentOverrides);
        if (data.summary) {
          setSummaryOverride(data.summary);
          setSignatures(nextSignatures);
        }
      }
    } catch (err) {
      if (key === currentKeyRef.current) {
        setTranslateError(err instanceof Error ? err.message : "Translate failed");
      }
    } finally {
      inFlightKeys.delete(key);
      if (key === currentKeyRef.current) setTranslating(false);
    }
  };

  return {
    languageMode,
    setLanguageMode,
    targetLang,
    setTargetLang,
    displaySegments,
    displaySummary,
    needsTranslation,
    hasAnyTranslation,
    translating,
    translateError,
    translate,
    dropSegmentTranslation,
  };
}
