"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { AttendanceSectionItem, MinutesMatter } from "@/lib/meeting/overviewSections";
import type { MinutesHeaderFields } from "@/lib/meeting/minutesTypes";
import { browserTimeZoneQuery } from "@/lib/meeting/minutesDefaults";
import type { MinutesDocContent, MinutesTranslation } from "@/lib/meeting/minutesTranslation";

export const ORIGINAL_VERSION = "original";
const SAVE_DEBOUNCE_MS = 800;

/** Language versions of the minutes: which one is on screen, adding and
 *  re-translating one from the original, deleting one, and editing one (saved
 *  to the server after a short pause). The original itself is edited through
 *  useMinutesEditor; this hook only handles the translated copies. */
export function useMinutesTranslations(meetingId: string) {
  const [translations, setTranslations] = useState<MinutesTranslation[]>([]);
  const [active, setActive] = useState(ORIGINAL_VERSION);
  const [translating, setTranslating] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pendingRef = useRef<{ language: string; content: MinutesDocContent } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!meetingId) return;
    let cancelled = false;
    fetch(`/api/meeting/${meetingId}/minutes/translations`)
      .then((res) => (res.ok ? (res.json() as Promise<{ translations: MinutesTranslation[] }>) : null))
      .then((data) => {
        if (!cancelled && data) setTranslations(data.translations);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  const flush = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/meeting/${meetingId}/minutes/translations/${pending.language}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: pending.content }),
      });
      if (!res.ok) throw new Error(`Could not save this language version (${res.status})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save this language version");
    } finally {
      setSaving(false);
    }
  }, [meetingId]);

  const select = useCallback(
    (language: string) => {
      void flush();
      setActive(language);
    },
    [flush],
  );

  /** Translates the current original into `language` (or translates it again). */
  const translate = useCallback(
    async (language: string) => {
      await flush();
      setTranslating(language);
      try {
        const res = await fetch(`/api/meeting/${meetingId}/minutes/translations?${browserTimeZoneQuery()}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language }),
        });
        const data = (await res.json().catch(() => null)) as { translation?: MinutesTranslation; error?: string } | null;
        if (!res.ok || !data?.translation) throw new Error(data?.error ?? `Translation failed (${res.status})`);
        const next = data.translation;
        setTranslations((prev) => (prev.some((t) => t.language === language) ? prev.map((t) => (t.language === language ? next : t)) : [...prev, next]));
        setActive(language);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Translation failed");
      } finally {
        setTranslating(null);
      }
    },
    [flush, meetingId],
  );

  const remove = useCallback(
    async (language: string) => {
      pendingRef.current = null;
      try {
        const res = await fetch(`/api/meeting/${meetingId}/minutes/translations/${language}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`Could not delete this version (${res.status})`);
        setTranslations((prev) => prev.filter((t) => t.language !== language));
        setActive((current) => (current === language ? ORIGINAL_VERSION : current));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not delete this version");
      }
    },
    [meetingId],
  );

  /** Applies an edit to the language version on screen and queues the save. */
  const edit = useCallback(
    (change: (content: MinutesDocContent) => MinutesDocContent) => {
      if (active === ORIGINAL_VERSION) return;
      setTranslations((prev) =>
        prev.map((t) => {
          if (t.language !== active) return t;
          const content = change(t.content);
          pendingRef.current = { language: t.language, content };
          return { ...t, content };
        }),
      );
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [active, flush],
  );

  const editHeader = useCallback(
    (field: keyof MinutesHeaderFields, value: string) => edit((c) => ({ ...c, header: { ...c.header, [field]: value || null } })),
    [edit],
  );
  const editAttendance = useCallback((attendance: AttendanceSectionItem[]) => edit((c) => ({ ...c, attendance })), [edit]);
  const editMatters = useCallback((matters: MinutesMatter[]) => edit((c) => ({ ...c, matters })), [edit]);

  const viewing = translations.find((t) => t.language === active) ?? null;
  return { translations, active: viewing ? active : ORIGINAL_VERSION, viewing, translating, saving, select, translate, remove, editHeader, editAttendance, editMatters };
}
