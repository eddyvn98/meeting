import fs from "node:fs";
import path from "node:path";

function ensureTransformersWasmAssets() {
  const store = path.resolve("node_modules/.pnpm");
  if (!fs.existsSync(store)) return;
  const onnxDists = fs.readdirSync(store)
    .filter((name) => name.startsWith("onnxruntime-web@"))
    .map((name) => path.join(store, name, "node_modules/onnxruntime-web/dist"));
  const transformersDist = path.resolve("node_modules/@huggingface/transformers/dist");
  if (!fs.existsSync(transformersDist)) return;
  for (const file of ["ort-wasm-simd-threaded.asyncify.wasm", "ort-wasm-simd-threaded.jsep.wasm", "ort-wasm-simd-threaded.jspi.wasm", "ort-wasm-simd-threaded.wasm", "ort.webgpu.bundle.min.mjs"]) {
    const target = path.join(transformersDist, file);
    if (fs.existsSync(target)) continue;
    const source = onnxDists.map((dir) => path.join(dir, file)).find(fs.existsSync);
    if (source) fs.copyFileSync(source, target);
  }
  const webEntry = path.join(transformersDist, "transformers.web.js");
  if (fs.existsSync(webEntry)) {
    const contents = fs.readFileSync(webEntry, "utf8");
    const patched = contents.replace('from "onnxruntime-web/webgpu"', 'from "./ort.webgpu.bundle.min.mjs"');
    if (patched !== contents) fs.writeFileSync(webEntry, patched);
  }
}

try { ensureTransformersWasmAssets(); } catch { /* Build can proceed when browser-only optional assets are unavailable. */ }

class SkipMinifyForOnnxWorker {
  apply(compiler) {
    compiler.hooks.compilation.tap("SkipMinifyForOnnxWorker", (compilation) => {
      compilation.hooks.processAssets.tap({
        name: "SkipMinifyForOnnxWorker",
        stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE,
      }, () => {
        for (const name of Object.keys(compilation.assets)) {
          if (!/ort\.webgpu\.bundle\.min(?:\.[^/]+)?\.mjs$/.test(name)) continue;
          const asset = compilation.getAsset(name);
          if (asset) compilation.updateAsset(name, asset.source, { ...asset.info, minimized: true });
        }
      });
    });
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@timur00kh/whisper.wasm"],
  async headers() {
    return [{ source: "/meeting/:path*", headers: [
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
    ] }];
  },
  webpack(config, { isServer }) {
    config.plugins.push(new SkipMinifyForOnnxWorker());
    if (isServer) {
      config.externals = [...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)), "@huggingface/transformers", "onnxruntime-node", "onnxruntime-web"];
    }
    config.module.rules.push({ test: /\.m?js$/, include: [/[/\\]node_modules[/\\].*@huggingface[/\\]transformers/, /[/\\]node_modules[/\\].*onnxruntime-web/, /[/\\]node_modules[/\\].*@timur00kh[/\\]whisper\.wasm/], parser: { javascript: { url: false } } });
    config.module.rules.push({ test: /\.wasm$/, type: "asset/resource" });
    config.resolve.alias = { ...config.resolve.alias, "onnxruntime-node$": false };
    if (!isServer) config.resolve.alias["@huggingface/transformers$"] = fs.realpathSync("node_modules/@huggingface/transformers/dist/transformers.web.js");
    return config;
  },
};

export default nextConfig;
