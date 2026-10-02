"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { browserTimeZoneQuery } from "@/lib/meeting/minutesDefaults";

/** Downloads the minutes as a .docx via GET .../minutes/export?format=docx
 *  (see app/api/meeting/[meetingId]/minutes/export/route.ts). `language` is a
 *  saved language version, or "original". There is no server-side PDF export:
 *  the page's print button prints what is on screen instead. */
export function useMinutesDocxExport(meetingId: string, language: string) {
  const [exporting, setExporting] = useState(false);

  const exportDocx = useCallback(async () => {
    if (!meetingId || exporting) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/meeting/${meetingId}/minutes/export?format=docx&language=${encodeURIComponent(language)}&${browserTimeZoneQuery()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error((data && typeof data === "object" && "error" in data && String(data.error)) || "Could not export DOCX");
        return;
      }

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? "MOM.docx";

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not export DOCX");
    } finally {
      setExporting(false);
    }
  }, [exporting, language, meetingId]);

  return { exporting, exportDocx };
}
