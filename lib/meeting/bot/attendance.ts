import type { AttendanceSectionItem } from "../overviewSections";
import type { AttendanceSuggestion } from "../types";

const normalize = (name: string) => name.trim().toLocaleLowerCase();

function stableRosterId(name: string, index: number): string {
  const safe = normalize(name).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return `roster_${index}_${safe || "participant"}`;
}

/** Builds the automatic Minutes attendance rows from the Teams roster.
 * Manual/stored attendance always takes precedence; callers use this only
 * when no attendance section has been saved for the meeting. */
export function buildRosterAttendanceDefaults(
  participantNames: string[],
  knownPeople: AttendanceSuggestion[] = [],
): AttendanceSectionItem[] {
  const known = new Map(knownPeople.map((person) => [normalize(person.name), person]));
  const seen = new Set<string>();
  const rows: AttendanceSectionItem[] = [];

  for (const rawName of participantNames) {
    const name = rawName.trim();
    const key = normalize(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const person = known.get(key);
    rows.push({
      id: stableRosterId(name, rows.length),
      name,
      role: person?.role ?? null,
      organization: person?.organization ?? null,
      status: "present",
    });
  }
  return rows;
}
