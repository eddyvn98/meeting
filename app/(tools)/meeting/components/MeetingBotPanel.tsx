"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { MeetingBotSession } from "@/lib/meeting/bot/types";
import { friendlyBotError, friendlyStatusLabel } from "@/lib/meeting/bot/sessionCopy";

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

function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function MeetingBotPanel({ activeLimit = 5, recentLimit = 5 }: { activeLimit?: number; recentLimit?: number }) {
  const [sessions, setSessions] = useState<MeetingBotSession[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [meetingUrl, setMeetingUrl] = useState("");
  const [meetingTitle, setMeetingTitle] = useState("");
  const [scheduledAtLocal, setScheduledAtLocal] = useState("");
  const [isStarting, setIsStarting] = useState(false);
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
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);

  const minSchedule = useMemo(() => toLocalInputValue(new Date(Date.now() - 4 * 60_000)), []);

  function scheduleIn(minutes: number) {
    setScheduledAtLocal(toLocalInputValue(new Date(Date.now() + minutes * 60_000)));
  }

  async function stopBot(session: MeetingBotSession) {
    if (loadingId) return;
    setLoadingId(session.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/meeting/bot-sessions/${encodeURIComponent(session.id)}`, { method: "POST" });
      const data = (await response.json()) as MeetingBotSession | { error?: string };
      if (!response.ok) throw new Error("error" in data ? data.error : "Failed to stop the bot.");
      setSessions((current) => current.map((item) => item.id === session.id ? data as MeetingBotSession : item));
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

  async function startBot() {
    if (isStarting) return;
    setIsStarting(true);
    setMessage(null);
    try {
      const scheduledAt = scheduledAtLocal ? new Date(scheduledAtLocal).toISOString() : undefined;
      const response = await fetch("/api/meeting/bot-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingUrl, title: meetingTitle, scheduledAt }),
      });
      const data = (await response.json()) as MeetingBotSession | { error?: string };
      if (!response.ok) throw new Error("error" in data ? data.error : "Failed to start the bot.");
      setSessions((current) => [data as MeetingBotSession, ...current.filter((item) => item.id !== (data as MeetingBotSession).id)]);
      setMeetingUrl("");
      setMeetingTitle("");
      setScheduledAtLocal("");
      setMessage(scheduledAt ? "Scheduled test created. The runner will claim it shortly before the selected time." : "Bot request created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to start the bot.");
    } finally {
      setIsStarting(false);
    }
  }

  const visibleSessions = sessions.filter((session) => ACTIVE_STATUSES.has(session.status)).slice(0, activeLimit);
  const finishedSessions = sessions.filter((session) => TERMINAL_STATUSES.has(session.status));
  const recentSessions = showAll ? finishedSessions : finishedSessions.slice(0, recentLimit);

  return (
    <section className="w-full rounded-xl border border-border bg-card p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-foreground">Add a bot to a meeting</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Paste a Teams link. Start immediately, or set a test time to verify the same scheduler used by calendar-discovered meetings before Microsoft Graph is approved.
        </p>
      </div>

      <div className="mb-2 grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-muted-foreground">
          Meeting link
          <input
            value={meetingUrl}
            onChange={(event) => setMeetingUrl(event.target.value)}
            placeholder="https://teams.microsoft.com/..."
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
            type="url"
            autoComplete="off"
          />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Title (optional)
          <input
            value={meetingTitle}
            onChange={(event) => setMeetingTitle(event.target.value)}
            placeholder="Teams Meeting"
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
            type="text"
            maxLength={180}
          />
        </label>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="grid gap-1">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Scheduled test time (optional)
            <input
              value={scheduledAtLocal}
              min={minSchedule}
              onChange={(event) => setScheduledAtLocal(event.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
              type="datetime-local"
            />
          </label>
          <div className="flex flex-wrap gap-1">
            {[2, 5, 10].map((minutes) => (
              <button
                key={minutes}
                type="button"
                onClick={() => scheduleIn(minutes)}
                className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                In {minutes} min
              </button>
            ))}
            {scheduledAtLocal && (
              <button
                type="button"
                onClick={() => setScheduledAtLocal("")}
                className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Run now instead
              </button>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void startBot()}
          disabled={isStarting || !meetingUrl.trim()}
          className="h-9 rounded-md bg-foreground px-4 text-xs font-semibold text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isStarting ? "Creating..." : scheduledAtLocal ? "Schedule test" : "Start bot"}
        </button>
      </div>

      {visibleSessions.length === 0 ? (
        <p className="text-xs text-muted-foreground">No active bot sessions.</p>
      ) : (
        <div className="grid gap-2">
          {visibleSessions.map((session) => (
            <div key={session.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 px-3 py-2 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1 truncate text-foreground">{session.title}</span>
              {session.scheduledAt && session.status === "REQUESTED" && (
                <span>Scheduled {new Date(session.scheduledAt).toLocaleString()}</span>
              )}
              <span className="font-medium text-foreground">{friendlyStatusLabel(session.status)}</span>
              {session.meetingId && <span>Recording created</span>}
              <button type="button" onClick={() => void stopBot(session)} disabled={loadingId !== null} className="rounded-md border border-border px-2.5 py-1 font-medium text-foreground hover:bg-muted disabled:opacity-50">
                {loadingId === session.id ? "Stopping..." : "Stop bot"}
              </button>
              {session.status === "FAILED" && session.errorMessage && <span className="basis-full text-red-500">{friendlyBotError(session.errorMessage)}</span>}
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
              onClick={() => void removeSessions(finishedSessions.map((item) => item.id), "/api/meeting/bot-sessions")}
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              Clear all
            </button>
          </div>
          <div className="grid gap-3">
            {recentSessions.map((session) => (
              <div key={session.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {session.meetingId ? (
                  <Link className="min-w-0 flex-1 truncate text-foreground hover:underline" href={`/meeting/${session.meetingId}/processing`}>
                    {session.title}
                  </Link>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-foreground">{session.title}</span>
                )}
                <span className={session.status === "FAILED" ? "text-red-500" : undefined}>{friendlyStatusLabel(session.status)}</span>
                <button
                  type="button"
                  onClick={() => void removeSessions([session.id], `/api/meeting/bot-sessions/${encodeURIComponent(session.id)}`)}
                  className="rounded-md px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
                >
                  Remove
                </button>
                {session.status === "FAILED" && session.errorMessage && (
                  <span className="basis-full text-muted-foreground">{friendlyBotError(session.errorMessage)}</span>
                )}
              </div>
            ))}
          </div>
          {finishedSessions.length > recentLimit && (
            <button type="button" onClick={() => setShowAll((value) => !value)} className="mt-3 text-xs text-muted-foreground hover:text-foreground hover:underline">
              {showAll ? "Show less" : `Show ${finishedSessions.length - recentLimit} more`}
            </button>
          )}
        </div>
      )}
      {message && <p className="mt-3 text-xs text-muted-foreground">{message}</p>}
    </section>
  );
}
