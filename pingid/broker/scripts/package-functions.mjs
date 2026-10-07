// Builds the Azure Functions zip-deploy package: a clean compile of the broker,
// host.json, and production dependencies only (no sources, tests, or secrets).
// Output: artifacts/broker-functions.zip
import { execFile } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(root, "artifacts");
const stage = path.join(artifacts, "functions-stage");
const output = path.join(artifacts, "broker-functions.zip");

await rm(path.join(root, "dist"), { recursive: true, force: true });
await run("npx", ["tsc", "-p", "tsconfig.json"], { cwd: root });

await rm(stage, { recursive: true, force: true });
await rm(output, { force: true });
await mkdir(stage, { recursive: true });
for (const file of ["host.json", "package.json", "package-lock.json"]) {
  await cp(path.join(root, file), path.join(stage, file));
}
await cp(path.join(root, "dist"), path.join(stage, "dist"), {
  recursive: true,
  filter: (source) => !/(\.test\.js|\.map)$/.test(source),
});
await run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: stage });
await run("zip", ["-q", "-r", output, "."], { cwd: stage });
await rm(stage, { recursive: true, force: true });
console.log(output);
