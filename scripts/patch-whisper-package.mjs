import { readFile, writeFile } from "node:fs/promises";

const packageDir = "node_modules/@timur00kh/whisper.wasm/dist";
const entryPath = `${packageDir}/index.es.js`;
const workerPath = `${packageDir}/libmain-D9-QM3iM.mjs`;

const entry = await readFile(entryPath, "utf8");
const entryBefore = 'import("./libmain-D9-QM3iM.mjs")).default({';
const entryAfter = 'import("./libmain-D9-QM3iM.mjs")).default({ mainScriptUrlOrBlob: typeof globalThis.location !== "undefined" ? new URL("/api/meeting/whisper-cpp-main", globalThis.location.href).href : void 0,';
if (!entry.includes(entryBefore) && !entry.includes("mainScriptUrlOrBlob")) {
  throw new Error("Unexpected whisper.wasm entry; update its isolated test patch.");
}
if (entry.includes(entryBefore)) await writeFile(entryPath, entry.replace(entryBefore, entryAfter));

const worker = await readFile(workerPath, "utf8");
const workerBefore = 'new Worker(new URL("", import.meta.url), { type: "module", name: "em-pthread" })';
if (!worker.includes(workerBefore) && !worker.includes("new Worker(import.meta.url")) {
  throw new Error("Unexpected whisper.wasm worker; update its isolated test patch.");
}
if (worker.includes(workerBefore)) await writeFile(workerPath, worker.replace(workerBefore, 'new Worker(import.meta.url, { type: "module", name: "em-pthread" })'));
