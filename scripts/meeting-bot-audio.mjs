import { spawn } from "node:child_process";

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

export async function createPulseAudioSession(sessionKey) {
  if (process.platform !== "linux") {
    throw new Error("Unattended browser audio capture requires a Linux runner with PulseAudio.");
  }
  const suffix = sessionKey.replace(/[^a-zA-Z0-9]/g, "").slice(-24);
  const sinkName = `teams_sink_${suffix}`;
  const sourceName = `teams_source_${suffix}`;
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
