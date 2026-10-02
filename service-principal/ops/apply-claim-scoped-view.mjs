// Creates the claim-scoped view defined in claim_scoped_view.sql.
//
// Databricks evaluates current_oauth_custom_identity_claim() while creating any
// object that references it, so a SQL editor session cannot create the view.
// This script runs the DDL with a claim-bearing token for an administration
// service principal, grants the runtime service principal SELECT, and then hands
// ownership to VIEW_OWNER so the creating principal keeps no standing access.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VIEW = "af_vault_genie_demo.nsclc_rwe_scoped.gold_patient_master_scoped";
const env = readEnv([
  "DBX_WORKSPACE_HOST",
  "DBX_WAREHOUSE_ID",
  "DBX_DDL_SP_CLIENT_ID",
  "DBX_DDL_SP_CLIENT_SECRET",
  "DBX_RUNTIME_SP_APPLICATION_ID",
  "VIEW_OWNER",
]);
const host = `https://${env.DBX_WORKSPACE_HOST.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
for (const name of ["DBX_RUNTIME_SP_APPLICATION_ID", "VIEW_OWNER"]) {
  if (!/^[\w.@-]{1,256}$/.test(env[name])) throw new Error(`${name} is not a valid principal name`);
}

const sqlFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "claim_scoped_view.sql");
const definition = (await readFile(sqlFile, "utf8"))
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .trim();

const token = await mintClaimToken();
await run(definition);
await run(`GRANT SELECT ON VIEW ${VIEW} TO \`${env.DBX_RUNTIME_SP_APPLICATION_ID}\``);
await run(`ALTER VIEW ${VIEW} OWNER TO \`${env.VIEW_OWNER}\``);
console.log(JSON.stringify({ view: VIEW, owner: env.VIEW_OWNER, reader: env.DBX_RUNTIME_SP_APPLICATION_ID }));

function readEnv(names) {
  const values = {};
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    values[name] = value;
  }
  return values;
}

async function mintClaimToken() {
  const credentials = Buffer.from(`${env.DBX_DDL_SP_CLIENT_ID}:${env.DBX_DDL_SP_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(`${host}/oidc/v1/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    // Any claim satisfies view creation; this one names the purpose in the token.
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "all-apis", custom_claim: "schema-administration" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error(`Token request failed with HTTP ${response.status}`);
  return payload.access_token;
}

async function run(statement) {
  let response = await call("POST", "/api/2.0/sql/statements", {
    warehouse_id: env.DBX_WAREHOUSE_ID,
    statement,
    wait_timeout: "50s",
    on_wait_timeout: "CONTINUE",
  });
  while (["PENDING", "RUNNING"].includes(response.status?.state)) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    response = await call("GET", `/api/2.0/sql/statements/${response.statement_id}`);
  }
  if (response.status?.state !== "SUCCEEDED") {
    throw new Error(`${statement.split("\n")[0]} failed: ${response.status?.error?.message ?? response.status?.state}`);
  }
}

async function call(method, apiPath, body) {
  const response = await fetch(`${host}${apiPath}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${apiPath} failed with HTTP ${response.status}: ${payload.message ?? ""}`);
  return payload;
}
