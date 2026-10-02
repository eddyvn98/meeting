import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const roots = ["app", "components", "hooks", "lib", "prisma", "scripts", "services", "stores", "__tests__"];
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".sql", ".prisma", ".md", ".json", ".css"]);
const pattern = new RegExp(["\\u0033\\u0036\\u0030\\u0069", "\\u006f\\u006e\\u0067[ -]?\\u006f\\u006e\\u0067", "\\u006f\\u006e\\u0067\\u006f\\u006e\\u0067\\u0064\\u0074", "\\u0072\\u0061\\u006e\\u006b\\u0069\\u006e\\u0065[ -]?\\u0068\\u0069\\u006c\\u006c"].join("|"), "i");
const hits = [];
async function walk(path) {
  let entries;
  try { entries = await readdir(path, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (extensions.has(file.slice(file.lastIndexOf(".")).toLowerCase())) {
      const lines = (await readFile(file, "utf8")).split(/\r?\n/);
      lines.forEach((line, index) => { if (pattern.test(line)) hits.push(`${relative(process.cwd(), file)}:${index + 1}`); });
    }
  }
}
for (const root of roots) await walk(root);
if (hits.length) { console.error(`Brand references found:\n${hits.join("\n")}`); process.exit(1); }
console.log("No brand references found in Meeting source.");
