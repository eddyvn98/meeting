import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

function runPactl(args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn("pactl", args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`pactl exited with ${code}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && typeof error === "object" && error.code === "EPERM";
  }
}

export async function cleanupStalePulseAudioModules() {
  if (process.platform !== "linux") return 0;
  const output = await runPactl(["list", "short", "modules"]).catch(() => "");
  if (!output) return 0;
  let removed = 0;
  for (const line of output.split("\n")) {
    const moduleId = line.split("\t")[0]?.trim();
    const match = line.match(/teams_(?:sink|source)_p(\d+)_/);
    if (!moduleId || !match) continue;
    const ownerPid = Number(match[1]);
    if (ownerPid === process.pid || processIsAlive(ownerPid)) continue;
    const unloaded = await runPactl(["unload-module", moduleId])
      .then(() => true)
      .catch(() => false);
    if (unloaded) removed += 1;
  }
  return removed;
}

export async function createPulseAudioSession(sessionKey) {
  if (process.platform !== "linux") {
    throw new Error("Unattended browser audio capture requires a Linux runner with PulseAudio.");
  }
  const sessionSuffix = sessionKey.replace(/[^a-zA-Z0-9]/g, "").slice(-16);
  const runSuffix = randomUUID().replace(/-/g, "").slice(0, 8);
  const suffix = `${sessionSuffix}_${runSuffix}`;
  const sinkName = `teams_sink_p${process.pid}_${suffix}`;
  const sourceName = `teams_source_p${process.pid}_${suffix}`;
  const sinkModule = await runPactl([
    "load-module", "module-null-sink", `sink_name=${sinkName}`,
    `sink_properties=device.description=${sinkName}`,
  ]);
  let sourceModule;
  try {
    sourceModule = await runPactl([
      "load-module", "module-remap-source", `source_name=${sourceName}`,
      `master=${sinkName}.monitor`, `source_properties=device.description=${sourceName}`,
    ]);
  } catch (error) {
    await runPactl(["unload-module", sinkModule]).catch(() => undefined);
    throw error;
  }

  return {
    sinkName,
    sourceName,
    async dispose() {
      await runPactl(["unload-module", sourceModule]).catch(() => undefined);
      await runPactl(["unload-module", sinkModule]).catch(() => undefined);
    },
  };
}
