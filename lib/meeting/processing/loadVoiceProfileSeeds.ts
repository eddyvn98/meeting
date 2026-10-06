import type { NamedSeedCentroid } from "@/lib/meeting/stt/diarization/speakerClustering";

/** Loads the shared voice library used to label known speakers during diarization. */
export async function loadVoiceProfileSeeds(): Promise<NamedSeedCentroid[]> {
  try {
    const response = await fetch("/api/meeting/voice-profiles", { cache: "no-store" });
    if (!response.ok) return [];
    const rows = (await response.json()) as { displayName: string; embedding: number[] }[];
    return rows.map((row) => ({
      displayName: row.displayName,
      embedding: new Float32Array(row.embedding),
    }));
  } catch {
    return [];
  }
}
