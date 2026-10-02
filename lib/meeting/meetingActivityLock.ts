"use client";

import { useSyncExternalStore } from "react";

export type MeetingActivity = "recording" | "uploading" | null;

let activity: MeetingActivity = null;
const listeners = new Set<() => void>();
let nextOwnerId = 0;
const activeOwners = new Map<number, Exclude<MeetingActivity, null>>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): MeetingActivity {
  return activity;
}

function getServerSnapshot(): MeetingActivity {
  return null;
}

function publishActivity(): void {
  let next: MeetingActivity = null;
  if (Array.from(activeOwners.values()).includes("recording")) {
    next = "recording";
  } else if (activeOwners.size > 0) {
    next = "uploading";
  }
  if (activity === next) return;
  activity = next;
  for (const listener of listeners) listener();
}

export function acquireMeetingActivity(next: Exclude<MeetingActivity, null>): () => void {
  const ownerId = ++nextOwnerId;
  activeOwners.set(ownerId, next);
  publishActivity();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeOwners.delete(ownerId);
    publishActivity();
  };
}

export function useMeetingActivity(): MeetingActivity {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
