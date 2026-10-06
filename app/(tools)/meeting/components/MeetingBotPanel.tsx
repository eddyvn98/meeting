"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { MeetingBotSession } from "@/lib/meeting/bot/types";
import { friendlyBotError, friendlyStatusLabel } from "@/lib/meeting/bot/sessionCopy";
import { MeetingSchedulePanel } from "./MeetingSchedulePanel";

const ACTIVE_STATUSES = new Set([
  "REQUESTED",
  "CLAIMED",
  "JOINING",
  "LOBBY",
  "JOINED",
  "CAPTURING",
  "STOP_REQUESTED",
]);

const TERMINAL_STATUSES = new Set(["ENDED", "FAILED"]);

export function MeetingBotPanel({
  activeLimit = 5,
  recentLimit = 5,
}: {
  activeLimit?: number;
  recentLimit?: number;
}) {
  const [sessions, setSessions] = useState<MeetingBotSession[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const response = await fetch("/api/meeting/bot-sessions", { cache: "no-store" });
      if (!response.ok || cancelled) return;
      setSessions((await response.json()) as MeetingBotSession[]);
    };
    void load().catch(() => undefined);
    const interval = window.setInterval(() => void load().catch(() => undefined), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  async function stopBot(session: MeetingBotSession) {
    if (loadingId) return;
    setLoadingId(session.id);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/meeting/bot-sessions/${encodeURIComponent(session.id)}`,
        { method: "POST" },
      );
      const data = (await response.json()) as MeetingBotSession | { error?: string };
      if (!response.ok) {
        throw new Error("error" in data ? data.error : "Failed to stop the bot.");
      }
      setSessions((current) =>
        current.map((item) => item.id === session.id ? data as MeetingBotSession : item),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to stop the bot.");
    } finally {
      setLoadingId(null);
    }
  }

  async function removeSessions(ids: string[], url: string) {
    setMessage(null);
    const previous = sessions;
    setSessions((current) => current.filter((item) => !ids.includes(item.id)));
    try {
      const response = await fetch(url, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to remove.");
    } catch {
      setSessions(previous);
      setMessage("Couldn't remove the session. Please try again.");
    }
  }

  const visibleSessions = sessions
    .filter((session) => ACTIVE_STATUSES.has(session.status))
    .slice(0, activeLimit);
  const finishedSessions = sessions.filter((session) => TERMINAL_STATUSES.has(session.status));
  const recentSessions = showAll ? finishedSessions : finishedSessions.slice(0, recentLimit);

  return (
    <div className="grid gap-4">
      <MeetingSchedulePanel />

      <section className="w-full rounded-xl border border-border bg-card p-4">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-foreground">Bot activity</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Scheduled meetings appear here when the runner starts joining them. Admit ONG STT Assistant from the Teams lobby when prompted.
          </p>
        </div>

        {visibleSessions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No active bot sessions.</p>
        ) : (
          <div className="grid gap-2">
            {visibleSessions.map((session) => (
              <div
                key={session.id}
                className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 px-3 py-2 text-xs text-muted-foreground"
              >
                <span className="min-w-0 flex-1 truncate text-foreground">{session.title}</span>
                {session.scheduledAt && session.status === "REQUESTED" && (
                  <span>{new Date(session.scheduledAt).toLocaleString()}</span>
                )}
                <span className="font-medium text-foreground">
                  {friendlyStatusLabel(session.status)}
                </span>
                {session.meetingId && <span>Recording created</span>}
                <button
                  type="button"
                  onClick={() => void stopBot(session)}
                  disabled={loadingId !== null}
                  className="rounded-md border border-border px-2.5 py-1 font-medium text-foreground hover:bg-muted disabled:opacity-50"
                >
                  {loadingId === session.id ? "Stopping..." : "Stop bot"}
                </button>
                {session.status === "FAILED" && session.errorMessage && (
                  <span className="basis-full text-red-500">
                    {friendlyBotError(session.errorMessage)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {finishedSessions.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Recent bot sessions</p>
              <button
                type="button"
                onClick={() =>
                  void removeSessions(
                    finishedSessions.map((item) => item.id),
                    "/api/meeting/bot-sessions",
                  )
                }
                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                Clear all
              </button>
            </div>
            <div className="grid gap-3">
              {recentSessions.map((session) => (
                <div
                  key={session.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
                >
                  {session.meetingId ? (
                    <Link
                      className="min-w-0 flex-1 truncate text-foreground hover:underline"
                      href={`/meeting/${session.meetingId}/processing`}
                    >
                      {session.title}
                    </Link>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {session.title}
                    </span>
                  )}
                  <span className={session.status === "FAILED" ? "text-red-500" : undefined}>
                    {friendlyStatusLabel(session.status)}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      void removeSessions(
                        [session.id],
                        `/api/meeting/bot-sessions/${encodeURIComponent(session.id)}`,
                      )
                    }
                    className="rounded-md px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
                  >
                    Remove
                  </button>
                  {session.status === "FAILED" && session.errorMessage && (
                    <span className="basis-full text-muted-foreground">
                      {friendlyBotError(session.errorMessage)}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {finishedSessions.length > recentLimit && (
              <button
                type="button"
                onClick={() => setShowAll((value) => !value)}
                className="mt-3 text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                {showAll ? "Show less" : `Show ${finishedSessions.length - recentLimit} more`}
              </button>
            )}
          </div>
        )}

        {message && <p className="mt-3 text-xs text-red-500">{message}</p>}
      </section>
    </div>
  );
}
