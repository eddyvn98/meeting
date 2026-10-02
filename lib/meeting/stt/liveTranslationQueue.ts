import { readLiveTranslationStream } from "./liveTranslationStream";

export interface LiveTranslationQueueItem {
  index: number;
  text: string;
  lang: string;
}

interface LiveTranslationQueueOptions {
  /** Translations already stored for one target language (index -> text).
   *  Kept per language so switching A -> B -> A never repeats finished work. */
  getTranslations: (lang: string) => Record<number, string>;
  isClosed: () => boolean;
  isEnabled: () => boolean;
  getTargetLanguage: () => string;
  onChange: () => void;
  onUnavailable: (index: number, lang: string) => void;
}

const MAX_CONCURRENT_TRANSLATIONS = 2;
const MAX_BATCH_SIZE = 4;
const MAX_PENDING_SEGMENTS = 12;
const BATCH_WINDOW_MS = 250;

/**
 * Sends immediately while idle, then coalesces bursts into small batches.
 * This preserves first-result latency without creating one Dify workflow per
 * segment when several STT segments arrive together.
 */
export function createLiveTranslationQueue(options: LiveTranslationQueueOptions) {
  const pending: LiveTranslationQueueItem[] = [];
  const queuedKeys = new Set<string>();
  const inFlightKeys = new Set<string>();
  const controllers = new Set<AbortController>();
  let active = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const publish = () => options.onChange();

  const keyOf = (item: LiveTranslationQueueItem) => `${item.lang}:${item.index}`;

  const markUnavailable = (batch: LiveTranslationQueueItem[]) => {
    if (options.isClosed() || !options.isEnabled()) return;
    for (const item of batch) options.onUnavailable(item.index, item.lang);
    publish();
  };

  const runBatch = async (batch: LiveTranslationQueueItem[]) => {
    const controller = new AbortController();
    controllers.add(controller);
    const lang = batch[0].lang;
    // Results land in the store of the batch's OWN language, so a batch that
    // finishes after the user switched language is kept for later.
    const store = options.getTranslations(lang);
    for (const item of batch) inFlightKeys.add(keyOf(item));
    let finished = false;
    try {
      const requestBody = batch.length === 1
        ? { targetLanguage: batch[0].lang, text: batch[0].text }
        : {
            targetLanguage: batch[0].lang,
            segments: batch.map(({ index, text }) => ({ index, text })),
          };
      const response = await fetch("/api/meeting/translate-live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        markUnavailable(batch);
        return;
      }

      if (!(response.headers.get("content-type") || "").includes("text/event-stream")) {
        const data = await response.json() as { translations?: Array<{ index?: number; text?: string }> };
        for (const item of data.translations ?? []) {
          if (typeof item.index === "number" && item.text?.trim()) store[item.index] = item.text.trim();
        }
        finished = true;
        publish();
        return;
      }

      await readLiveTranslationStream(response, (event) => {
        if (options.isClosed() || !options.isEnabled()) return;
        if (event.type === "batch-complete") {
          for (const item of event.translations ?? []) {
            if (typeof item.index === "number" && item.text?.trim()) store[item.index] = item.text.trim();
          }
          publish();
        } else if (batch.length === 1 && event.type === "reset") {
          delete store[batch[0].index];
        } else if (batch.length === 1 && event.type === "chunk" && event.text) {
          store[batch[0].index] = `${store[batch[0].index] ?? ""}${event.text}`;
          publish();
        } else if (batch.length === 1 && event.type === "complete" && event.translated && !store[batch[0].index]) {
          store[batch[0].index] = event.translated;
          publish();
        } else if (event.type === "error") {
          throw new Error(event.error || "Translation upstream failed");
        }
      });

      finished = true;
      if (!options.isClosed() && options.isEnabled()) {
        for (const item of batch) {
          if (!store[item.index]) options.onUnavailable(item.index, item.lang);
        }
        publish();
      }
    } catch {
      markUnavailable(batch);
    } finally {
      // A single-item batch streams its text in pieces: an aborted or failed
      // stream must not leave a half translation behind as if it were final.
      if (!finished && batch.length === 1 && store[batch[0].index] !== "—") delete store[batch[0].index];
      for (const item of batch) inFlightKeys.delete(keyOf(item));
      controllers.delete(controller);
      active -= 1;
      drain();
    }
  };

  const schedule = () => {
    if (timer || pending.length === 0) return;
    timer = setTimeout(() => {
      timer = null;
      drain();
    }, BATCH_WINDOW_MS);
  };

  function drain() {
    if (options.isClosed() || !options.isEnabled()) return;
    while (active < MAX_CONCURRENT_TRANSLATIONS && pending.length > 0) {
      const batch = pending.splice(0, MAX_BATCH_SIZE);
      for (const item of batch) queuedKeys.delete(keyOf(item));
      active += 1;
      void runBatch(batch);
    }
    if (pending.length > 0 && active >= MAX_CONCURRENT_TRANSLATIONS) schedule();
  }

  const enqueueMany = (items: LiveTranslationQueueItem[]) => {
    if (options.isClosed() || !options.isEnabled()) return;
    for (const item of items) {
      const key = keyOf(item);
      if (!item.text.trim() || options.getTranslations(item.lang)[item.index] || queuedKeys.has(key) || inFlightKeys.has(key)) continue;
      queuedKeys.add(key);
      pending.push(item);
    }
    while (pending.length > MAX_PENDING_SEGMENTS) {
      const dropped = pending.shift();
      if (!dropped) break;
      queuedKeys.delete(keyOf(dropped));
      options.onUnavailable(dropped.index, dropped.lang);
    }
    if (pending.length >= MAX_BATCH_SIZE || active === 0) drain();
    else schedule();
  };

  /** Drops work that has not been sent yet; requests already in flight finish
   *  and are stored under their own language. */
  const clearPending = () => {
    pending.length = 0;
    queuedKeys.clear();
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const clear = () => {
    clearPending();
    for (const controller of controllers) controller.abort();
    controllers.clear();
  };

  const close = () => clear();

  return { enqueueMany, clearPending, clear, close };
}
