import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function findWhisperMain(): Promise<string> {
  const pnpmDir = path.join(process.cwd(), "node_modules", ".pnpm");
  const entries = await fs.readdir(pnpmDir);
  const packageDir = entries.find((entry) => entry.startsWith("@timur00kh+whisper.wasm@"));
  if (!packageDir) throw new Error("whisper.cpp WASM package is not installed");
  return path.join(pnpmDir, packageDir, "node_modules", "@timur00kh", "whisper.wasm", "dist", "libmain-D9-QM3iM.mjs");
}

export async function GET() {
  const source = await fs.readFile(await findWhisperMain());
  return new NextResponse(source, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": "text/javascript; charset=utf-8",
      "Cross-Origin-Embedder-Policy": "credentialless",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  });
}
