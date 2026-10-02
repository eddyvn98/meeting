"use client";

import { useEffect, useMemo, useState } from "react";
import type { MeetingBotSchedule, MeetingScheduleRepeat } from "@/lib/meeting/bot/types";
import { parseTeamsInvitation } from "@/lib/meeting/bot/invitation";

const REPEAT_OPTIONS: Array<{ value: MeetingScheduleRepeat; label: string }> = [
  { value: "NONE", label: "Never" },
  { value: "DAILY", label: "Every day" },
  { value: "WEEKDAYS", label: "Every weekday" },
  { value: "WEEKLY", label: "Every week" },
  { value: "BIWEEKLY", label: "Every 2 weeks" },
  { value: "MONTHLY", label: "Every month" },
];

function toLocalInputValue(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function repeatLabel(value: MeetingScheduleRepeat): string {
  return REPEAT_OPTIONS.find((item) => item.value === value)?.label ?? value;
}

function scheduleTime(schedule: MeetingBotSchedule): string {
  const value = schedule.nextRunAt ?? schedule.startAt;
  return new Date(value).toLocaleString();
}

export function MeetingSchedulePanel() {
  const [schedules, setSchedules] = useState<MeetingBotSchedule[]>([]);
  const [sourceText, setSourceText] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [title, setTitle] = useState("");
  const [startLocal, setStartLocal] = useState("");
  const [repeat, setRepeat] = useState<MeetingScheduleRepeat>("NONE");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const minStart = useMemo(() => toLocalInputValue(new Date(Date.now() - 4 * 60_000)), []);

  async function loadSchedules() {
    const response = await fetch("/api/meeting/bot-schedules", { cache: "no-store" });
    if (!response.ok) return;
    setSchedules((await response.json()) as MeetingBotSchedule[]);
  }

  useEffect(() => {
    void loadSchedules().catch(() => undefined);
    const timer = window.setInterval(() => void loadSchedules().catch(() => undefined), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  function applyPaste(value: string) {
    setSourceText(value);
    const parsed = parseTeamsInvitation(value);
    if (parsed.meetingUrl) setMeetingUrl(parsed.meetingUrl);
    if (parsed.title) setTitle(parsed.title);
    if (parsed.startLocal) setStartLocal(parsed.startLocal);
  }

  function resetForm() {
    setSourceText("");
    setMeetingUrl("");
    setTitle("");
    setStartLocal("");
    setRepeat("NONE");
    setEditingId(null);
  }

  function editSchedule(schedule: MeetingBotSchedule) {
    setEditingId(schedule.id);
    setSourceText(schedule.meetingUrl);
    setMeetingUrl(schedule.meetingUrl);
    setTitle(schedule.title);
    setStartLocal(toLocalInputValue(schedule.startAt));
    setRepeat(schedule.repeat);
    setMessage(null);
  }

  async function saveSchedule() {
    if (!meetingUrl || !startLocal || busyId) return;
    setBusyId(editingId ?? "new");
    setMessage(null);
    try {
      const url = editingId
        ? `/api/meeting/bot-schedules/${encodeURIComponent(editingId)}`
        : "/api/meeting/bot-schedules";
      const response = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingUrl,
          title,
          startAt: new Date(startLocal).toISOString(),
          repeat,
          ...(editingId ? {} : { enabled: true }),
        }),
      });
      const data = (await response.json()) as MeetingBotSchedule | { error?: string };
      if (!response.ok) throw new Error("error" in data ? data.error : "Failed to save the schedule.");
      resetForm();
      await loadSchedules();
      setMessage(editingId ? "Meeting schedule updated." : "Meeting schedule saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save the schedule.");
    } finally {
      setBusyId(null);
    }
  }

  async function setEnabled(schedule: MeetingBotSchedule, enabled: boolean) {
    if (busyId) return;
    setBusyId(schedule.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/meeting/bot-schedules/${encodeURIComponent(schedule.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = (await response.json()) as MeetingBotSchedule | { error?: string };
      if (!response.ok) throw new Error("error" in data ? data.error : "Failed to update the schedule.");
      setSchedules((current) => current.map((item) => item.id === schedule.id ? data as MeetingBotSchedule : item));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update the schedule.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeSchedule(schedule: MeetingBotSchedule) {
    if (busyId || !window.confirm(`Delete "${schedule.title}"?`)) return;
    setBusyId(schedule.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/meeting/bot-schedules/${encodeURIComponent(schedule.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete the schedule.");
      setSchedules((current) => current.filter((item) => item.id !== schedule.id));
      if (editingId === schedule.id) resetForm();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete the schedule.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-foreground">
          {editingId ? "Edit scheduled meeting" : "Schedule a meeting"}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Paste a Teams link or the full invitation. If the invitation contains a title and time, they are filled automatically.
        </p>
      </div>

      <div className="grid gap-3">
        <label className="grid gap-1 text-xs text-muted-foreground">
          Teams link or invitation
          <textarea
            value={sourceText}
            onChange={(event) => applyPaste(event.target.value)}
            placeholder={"Paste a Teams link, or paste the whole Outlook/Teams invitation..."}
            rows={3}
            className="resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Teams Meeting"
              maxLength={180}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
            />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Start
            <input
              value={startLocal}
              min={minStart}
              onChange={(event) => setStartLocal(event.target.value)}
              type="datetime-local"
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Repeat
            <select
              value={repeat}
              onChange={(event) => setRepeat(event.target.value as MeetingScheduleRepeat)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
            >
              {REPEAT_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="h-9 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={() => void saveSchedule()}
              disabled={!meetingUrl || !startLocal || busyId !== null}
              className="h-9 rounded-md bg-foreground px-4 text-xs font-semibold text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busyId === (editingId ?? "new") ? "Saving..." : "Save"}
            </button>
          </div>
        </div>

        {meetingUrl && (
          <p className="truncate text-[11px] text-muted-foreground">
            Teams link detected: {meetingUrl}
          </p>
        )}
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-foreground">Scheduled meetings</h3>
          <span className="text-[11px] text-muted-foreground">{schedules.length} saved</span>
        </div>

        {schedules.length === 0 ? (
          <p className="text-xs text-muted-foreground">No scheduled meetings yet.</p>
        ) : (
          <div className="grid gap-2">
            {schedules.map((schedule) => (
              <div key={schedule.id} className="rounded-md border border-border/70 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {schedule.title}
                  </span>
                  <span className={schedule.enabled ? "text-xs text-foreground" : "text-xs text-muted-foreground"}>
                    {schedule.enabled ? "Auto join ON" : "Paused"}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{schedule.enabled && schedule.nextRunAt ? scheduleTime(schedule) : "No upcoming run"}</span>
                  <span>{repeatLabel(schedule.repeat)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => editSchedule(schedule)}
                    className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void setEnabled(schedule, !schedule.enabled)}
                    disabled={busyId !== null}
                    className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    {schedule.enabled ? "Pause" : "Enable"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeSchedule(schedule)}
                    disabled={busyId !== null}
                    className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {message && <p className="mt-3 text-xs text-muted-foreground">{message}</p>}
    </section>
  );
}
