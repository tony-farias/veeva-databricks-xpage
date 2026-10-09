import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = path.join(root, "public", "vendor");
await mkdir(vendorDir, { recursive: true });

await copyFile(path.join(root, "node_modules", "q", "q.js"), path.join(vendorDir, "q.js"));

// Veeva distributes the MyInsights library through the Veeva CRM Developer
// Portal rather than a public CDN, so the build reads a downloaded copy.
const configuredSource = process.env.VEEVA_MYINSIGHTS_LIBRARY_PATH;
if (!configuredSource) {
  throw new Error(
    "Set VEEVA_MYINSIGHTS_LIBRARY_PATH to the MyInsights library (for example myinsights-v2-0.js) "
      + "downloaded from the Veeva CRM Developer Portal.",
  );
}
const library = await readFile(path.resolve(configuredSource), "utf8");

if (!library.includes("getSFDCSessionID")) {
  throw new Error("The supplied file is not a MyInsights library with getSFDCSessionID()");
}
await writeFile(path.join(vendorDir, "myinsights.js"), library, "utf8");
