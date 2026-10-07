import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist", "index.html");
let html = await readFile(output, "utf8");

const moduleScript = /<script type="module"(?: crossorigin)? src="([^"]+)"><\/script>/;
const match = html.match(moduleScript);
if (!match) {
  throw new Error("Expected Vite to emit exactly one module entry script");
}

html = html
  .replace(moduleScript, `<script defer src="${match[1]}"></script>`)
  .replace(/(<link rel="stylesheet") crossorigin/g, "$1");

if (/type="module"|\bcrossorigin\b/.test(html)) {
  throw new Error("The finalized X-Page still contains module/CORS-only markup");
}

await writeFile(output, html, "utf8");
