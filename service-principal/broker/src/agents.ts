import type { BrokerConfig } from "./config.js";
import { DatabricksError, databricksFetch, workspaceUrl } from "./databricks.js";

export interface GenieAgent {
  id: string;
  title: string;
  description: string | null;
}

interface StatementResponse {
  status?: { state?: string; error?: { error_code?: string } };
  result?: { data_array?: unknown[] };
  error_code?: string;
}

// Every broker session seals the Agent IDs it may open, so keep the list short.
export const MAX_AGENTS = 25;
const METADATA_TTL_MS = 5 * 60_000;
const AGENT_ID = /^[a-z0-9_-]{8,128}$/i;

// A title and description belong to the Genie space, not to a user, so they are
// cached by Agent ID. Which Agents a user may open is never cached: every new
// broker session reads the directory again, so revocation takes one session.
const metadataCache = new Map<string, { agent: GenieAgent; expiresAt: number }>();

export async function resolveAgents(config: BrokerConfig, accessToken: string): Promise<GenieAgent[]> {
  const ids = config.agentSource.kind === "fixed"
    ? [config.agentSource.agentId]
    : await readAgentDirectory(config, config.agentSource, accessToken);
  const agents = await Promise.all(ids.map((id) => agentMetadata(config, accessToken, id)));
  return agents
    .filter((agent): agent is GenieAgent => agent !== null)
    .sort((left, right) => left.title.localeCompare(right.title));
}

// The directory view filters on current_oauth_custom_identity_claim(), so the
// claim-bearing token returns only this user's Agents. The service principal
// cannot read the role tables behind it.
async function readAgentDirectory(
  config: BrokerConfig,
  directory: { view: string; warehouseId: string },
  accessToken: string,
): Promise<string[]> {
  const response = await databricksFetch(workspaceUrl(config, "/api/2.0/sql/statements"), accessToken, {
    method: "POST",
    body: JSON.stringify({
      warehouse_id: directory.warehouseId,
      statement: `SELECT agent_id FROM ${directory.view}`,
      wait_timeout: "30s",
      on_wait_timeout: "CANCEL",
      disposition: "INLINE",
      format: "JSON_ARRAY",
      row_limit: MAX_AGENTS * 4,
    }),
    signal: AbortSignal.timeout(40_000),
  });
  const payload = await response.json().catch(() => ({})) as StatementResponse;
  if (!response.ok || payload.status?.state !== "SUCCEEDED") {
    console.warn(JSON.stringify({
      event: "agents.directory_failed",
      timestamp: new Date().toISOString(),
      status: response.status,
      state: payload.status?.state ?? null,
      error: payload.status?.error?.error_code ?? payload.error_code ?? null,
    }));
    throw new DatabricksError("agent_directory_unavailable", 502);
  }
  const ids = new Set<string>();
  for (const row of payload.result?.data_array ?? []) {
    const value = Array.isArray(row) && typeof row[0] === "string" ? row[0].trim() : "";
    if (AGENT_ID.test(value)) ids.add(value);
  }
  if (ids.size > MAX_AGENTS) {
    console.warn(JSON.stringify({
      event: "agents.directory_truncated",
      timestamp: new Date().toISOString(),
      returned: ids.size,
      kept: MAX_AGENTS,
    }));
  }
  return [...ids].sort().slice(0, MAX_AGENTS);
}

async function agentMetadata(config: BrokerConfig, accessToken: string, id: string): Promise<GenieAgent | null> {
  const cached = metadataCache.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached.agent;
  const response = await databricksFetch(
    workspaceUrl(config, `/api/2.0/genie/spaces/${encodeURIComponent(id)}`),
    accessToken,
  );
  if ([400, 403, 404].includes(response.status)) {
    // An entitled Agent the service principal cannot open is left out, rather
    // than offered to the user and failing on the first question.
    console.warn(JSON.stringify({
      event: "agents.unavailable",
      timestamp: new Date().toISOString(),
      agentId: id,
      status: response.status,
    }));
    return null;
  }
  if (!response.ok) throw new DatabricksError("agent_lookup_failed", 502);
  const payload = await response.json().catch(() => ({})) as { title?: unknown; description?: unknown };
  const agent: GenieAgent = {
    id,
    title: plainText(payload.title, 200) || "Genie Agent",
    description: plainText(payload.description, 2_000) || null,
  };
  metadataCache.set(id, { agent, expiresAt: Date.now() + METADATA_TTL_MS });
  return agent;
}

function plainText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function clearAgentCacheForTests(): void {
  metadataCache.clear();
}
