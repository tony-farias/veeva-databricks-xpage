import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(root, "artifacts");
const output = path.join(artifacts, "vault-crm-genie-service-principal-xpage.zip");
await mkdir(artifacts, { recursive: true });
await rm(output, { force: true });
await execFileAsync("zip", ["-q", "-r", output, "."], { cwd: path.join(root, "dist") });
console.log(output);
