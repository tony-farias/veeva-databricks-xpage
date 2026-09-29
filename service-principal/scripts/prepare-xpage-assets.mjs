import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = path.join(root, "public", "vendor");
await mkdir(vendorDir, { recursive: true });

await copyFile(path.join(root, "node_modules", "q", "q.js"), path.join(vendorDir, "q.js"));

const configuredSource = process.env.VEEVA_XPAGES_LIBRARY_PATH;
let library;
if (configuredSource) {
  library = await readFile(path.resolve(configuredSource), "utf8");
} else {
  const response = await fetch("https://crm-app-cdn.veeva-vcrm.com/x-pages/library/X-PagesLibrary.js");
  if (!response.ok) throw new Error(`Unable to download X-PagesLibrary.js: ${response.status}`);
  library = await response.text();
}

if (!library.includes("window.ds")) throw new Error("The supplied file is not a valid X-Pages library");
await writeFile(path.join(vendorDir, "X-PagesLibrary.js"), library, "utf8");
