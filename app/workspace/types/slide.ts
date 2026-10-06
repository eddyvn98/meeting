/** Data model for the "slideDeck" block — a Miro-Slides-style presentation
 *  built from the workspace's existing block primitives rather than a new
 *  free-form nested canvas (see slideDeckOps.ts for why: a full frame/
 *  containment engine, where arbitrary shapes can be dragged onto a slide
 *  and move with it, is a materially larger system not justified yet).
 *  Each slide's body is rich text (the same TipTap HTML the "doc" block
 *  already uses), edited via WorkspaceDocRichEditor. */

import type { SlideAnimation, SlideTransition } from "../utils/slideMotion";

export type SlideStatus = "not_started" | "in_progress" | "done";

export interface SlideMeta {
  id: string;
  name: string;
  html: string;
  /** CSS color for the slide's background in both the editor and Present mode. */
  backgroundColor?: string;
  /** Shown only in Present mode's notes panel, never in the audience-facing slide. */
  presenterNotes?: string;
  status?: SlideStatus;
  /** Hidden slides stay in the editor (filmstrip shows them dimmed) but are skipped in Present mode. */
  hidden?: boolean;
  transition?: SlideTransition;
  animation?: SlideAnimation;
}

/** Deck-wide look. A slide's own backgroundColor still wins over the theme background. */
export interface SlideTheme {
  backgroundColor?: string;
  textColor?: string;
  fontFamily?: string;
  /** Accent colour for big numbers, step numbers, quote bars and table headers. */
  accentColor?: string;
  /** Id of the preset this theme was built from (see slideThemePresets.ts); informational. */
  preset?: string;
}

export type SlideAspectRatio = "16:9" | "4:3";

export interface SlideDeckPayload {
  slideOrder: string[];
  slides: Record<string, SlideMeta>;
  aspectRatio?: SlideAspectRatio;
  /** Last-selected slide, restored on reopen; absent = first slide. */
  activeSlideId?: string;
  /** Optional deck title, shown in the deck toolbar. */
  title?: string;
  theme?: SlideTheme;
  /** Shows "n" in the corner of every slide in the editor and Present mode. */
  showSlideNumbers?: boolean;
}

export const SLIDE_STATUS_LABEL: Record<SlideStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  done: "Done",
};

export const SLIDE_STATUS_COLOR: Record<SlideStatus, string> = {
  not_started: "#94a3b8",
  in_progress: "#f59e0b",
  done: "#22c55e",
};
