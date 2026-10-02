"use client";

import { createContext, useContext } from "react";
import type { MinutesCommentsApi } from "./types";

/** Null when comments are unavailable (public link, or loading), in which
 *  case the Minutes table renders without any comment affordance. */
const MinutesCommentsContext = createContext<MinutesCommentsApi | null>(null);

export const MinutesCommentsProvider = MinutesCommentsContext.Provider;

export function useMinutesCommentsApi(): MinutesCommentsApi | null {
  return useContext(MinutesCommentsContext);
}
