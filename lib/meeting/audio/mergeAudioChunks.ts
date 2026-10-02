/**
 * lib/meeting/audio/mergeAudioChunks.ts
 *
 * Stitches a live recording's independently-encoded 30s webm chunks
 * (chunkController.ts starts a NEW MediaRecorder per chunk, so each one is
 * its own standalone file, not a fragment of one stream — see that file's
 * doc comment) into a single continuous, seekable file the audio route can
 * serve start to finish. Uses ffmpeg's `concat` audio filter (decode +
 * re-encode every input into one output stream) rather than the `-f concat`
 * demuxer / stream copy, which only works when inputs share identical
 * codec parameters and container framing — not guaranteed here.
 */

import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { rename, rm } from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";

// `ffmpeg-static` can be present in node_modules while its platform binary is
// missing (for example after an install with lifecycle scripts disabled).
// Do not pin fluent-ffmpeg to that dead path; when it is unavailable, let
// fluent-ffmpeg resolve a working system `ffmpeg` from PATH instead.
if (ffmpegPath && existsSync(ffmpegPath)) ffmpeg.setFfmpegPath(ffmpegPath);

export type MergeAudioChunksResult = { success: true } | { success: false; error: string };

/** Re-encodes `inputPaths` (in order) into one AAC/M4A file at `outputPath`.
 *  Resolves `{ success: true }` on success, `{ success: false, error }` on
 *  any ffmpeg failure — callers should treat a failure as "keep serving the
 *  first chunk", not throw, but should surface `error` somewhere it can
 *  actually be read (it is only ever `console.warn`'d here). */
export async function mergeAudioChunks(inputPaths: string[], outputPath: string, options: { allowSingle?: boolean } = {}): Promise<MergeAudioChunksResult> {
  if (inputPaths.length === 0) return { success: false, error: "No input chunks provided." };
  if (inputPaths.length === 1 && !options.allowSingle) {
    // Nothing to stitch — let the caller just serve that one file directly
    // instead of paying for a re-encode.
    return { success: false, error: "Only one chunk; nothing to merge." };
  }

  const tempOutputPath = `${outputPath}.${randomUUID()}.tmp`;
  return new Promise((resolve) => {
    const command = ffmpeg();
    for (const path of inputPaths) command.input(path);

    const filter = inputPaths.map((_, i) => `[${i}:a]`).join("") + `concat=n=${inputPaths.length}:v=0:a=1[out]`;

    command
      .complexFilter([filter])
      .outputOptions(["-map", "[out]"])
      .audioCodec("aac")
      .audioBitrate("128k")
      // The temp path ends in `.tmp` (not `.m4a`) so ffmpeg can't infer the
      // container from the filename and aborts with "Unable to choose an
      // output format" / "Invalid argument" — force the M4A/iTunes muxer
      // explicitly instead of relying on the final extension.
      .format("ipod")
      .on("error", (err, _stdout, stderr) => {
        // Logged (not swallowed): a merge failure silently degrades playback
        // and local STT to chunk 0 only, which looks like "it just works,
        // slightly wrong" rather than an obvious failure — see finalize
        // /route.ts and audio/route.ts for that fallback.
        const message = err instanceof Error ? err.message : String(err);
        console.warn("[meeting] mergeAudioChunks ffmpeg error:", message);
        if (stderr) console.warn("[meeting] mergeAudioChunks ffmpeg stderr:", stderr);
        void rm(tempOutputPath, { force: true }).finally(() => resolve({ success: false, error: message }));
      })
      .on("end", () => {
        void rename(tempOutputPath, outputPath)
          .then(() => resolve({ success: true }))
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            console.warn("[meeting] mergeAudioChunks atomic rename failed:", message);
            return rm(tempOutputPath, { force: true }).finally(() =>
              resolve({ success: false, error: `atomic rename failed: ${message}` }),
            );
          });
      })
      .save(tempOutputPath);
  });
}

const FFMPEG_BINARY = ffmpegPath && existsSync(ffmpegPath) ? ffmpegPath : "ffmpeg";

export interface ReadableSplit {
  readable: string[];
  unreadable: string[];
  /** ffmpeg itself could not be started, so nothing can be said about the files. */
  toolMissing: boolean;
}

/** Decodes each file to nowhere to find out whether ffmpeg can read it. One
 *  corrupt part makes the whole concat fail, so merging only the readable
 *  parts rescues a recording that would otherwise be lost entirely. */
export async function splitReadableChunks(paths: string[]): Promise<ReadableSplit> {
  const results = await Promise.all(
    paths.map(
      (path) =>
        new Promise<"ok" | "bad" | "missing-tool">((resolve) => {
          execFile(FFMPEG_BINARY, ["-v", "error", "-xerror", "-i", path, "-f", "null", "-"], { timeout: 120_000 }, (error) => {
            if (!error) return resolve("ok");
            resolve((error as NodeJS.ErrnoException).code === "ENOENT" ? "missing-tool" : "bad");
          });
        }),
    ),
  );
  if (results.includes("missing-tool")) return { readable: paths, unreadable: [], toolMissing: true };
  return {
    readable: paths.filter((_, i) => results[i] === "ok"),
    unreadable: paths.filter((_, i) => results[i] === "bad"),
    toolMissing: false,
  };
}
