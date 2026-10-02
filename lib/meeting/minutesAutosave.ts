/**
 * lib/meeting/minutesAutosave.ts
 *
 * Pure state machine behind the MOM editor's debounced autosave (Stage B —
 * useMinutesEditor.ts). Kept separate from the hook itself so the
 * transition logic can be unit-tested without React or fake timers: the
 * hook owns the actual `setTimeout`/`fetch` calls, this file only decides
 * what the resulting `status` should be for a given event.
 *
 * Debounce window: ~800ms, per the Stage B spec — the hook, not this file,
 * owns the literal timer duration; this only reasons about state.
 */

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export interface AutosaveState {
  status: AutosaveStatus;
  /** Bumped on every `edit` — the hook uses this to recognize a *newer*
   *  edit arrived while a save was already in flight, so it knows to
   *  schedule one more save after the current one resolves instead of
   *  treating that save's success as covering the newest edit too. */
  editToken: number;
  /** editToken as of the save currently in flight (or the last one that
   *  completed) — compared against `editToken` to detect that staleness. */
  savedToken: number;
}

export type AutosaveEvent =
  | { type: "edit" }
  | { type: "timerFired" }
  | { type: "saveStart" }
  | { type: "saveSuccess" }
  | { type: "saveError" };

export const INITIAL_AUTOSAVE_STATE: AutosaveState = { status: "idle", editToken: 0, savedToken: 0 };

/** True when a fresh save should be (re)scheduled after this transition —
 *  i.e. there's an edit newer than the last save the hook knows about. */
export function hasUnsavedEdit(state: AutosaveState): boolean {
  return state.editToken !== state.savedToken;
}

export function autosaveReducer(state: AutosaveState, event: AutosaveEvent): AutosaveState {
  switch (event.type) {
    case "edit":
      return { ...state, status: "pending", editToken: state.editToken + 1 };
    case "timerFired":
      // The debounce timer firing doesn't itself start the network call —
      // the hook does that next via saveStart — but a timer that fires
      // with nothing pending (already saved/idle) is a no-op.
      return state;
    case "saveStart":
      return { ...state, status: "saving", savedToken: state.editToken };
    case "saveSuccess":
      // If another edit landed while this save was in flight, editToken
      // has moved past savedToken again — status goes back to "pending"
      // (not "saved") so the hook knows to schedule another save.
      return { ...state, status: hasUnsavedEdit(state) ? "pending" : "saved" };
    case "saveError":
      // Roll `savedToken` back so hasUnsavedEdit is true again — a failed
      // save must not be mistaken for a successful one covering that edit.
      return { ...state, status: "error", savedToken: state.savedToken - 1 };
    default:
      return state;
  }
}
