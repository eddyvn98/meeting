import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig({ resolve: { alias: { "@": root } }, test: { include: ["__tests__/**/*.test.ts", "__tests__/**/*.test.tsx"], environment: "node" } });
