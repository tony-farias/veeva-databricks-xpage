import assert from "node:assert/strict";
import test from "node:test";
import { clearAgentCacheForTests, MAX_AGENTS, resolveAgents } from "./agents.js";
import type { BrokerConfig } from "./config.js";

const heorAgent = "01f1b7b1764a1a04adc67a648599a233";
const medicalAgent = "01f1bd3908071673887fd1a3ba14d351";

const baseConfig: BrokerConfig = {
  workspaceHost: "workspace.example.com",
  agentSource: { kind: "directory", view: "demo_catalog.genie_access.my_genie_agents", warehouseId: "befedd56fadee1fa" },
  veevaVaultOrigins: new Set(["https://vault.example.com"]),
  veevaVaultApiVersion: "v26.1",
  identityClaimSource: "user_name",
  servicePrincipalClientId: "service-principal-client-id",
  servicePrincipalClientSecret: "service-principal-client-secret",
  servicePrincipalDisplayName: "shared-genie-runtime",
  servicePrincipalOauthScope: "all-apis",
  brokerSessionTtlMs: 900_000,
  stateSecret: "this-is-a-test-secret-with-more-than-thirty-two-bytes",
  allowedParentOrigins: new Set(["https://vault.example.com"]),
  allowOpaqueParentOrigin: false,
  allowVeevaParentOrigins: false,
  port: 8787,
};

interface FakeWorkspace {
  directoryRows?: unknown[];
  directoryState?: string;
  spaces?: Record<string, { status: number; title?: string; description?: string }>;
}

function fakeWorkspace(context: test.TestContext, workspace: FakeWorkspace): string[] {
  clearAgentCacheForTests();
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
    clearAgentCacheForTests();
  });
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.host, "workspace.example.com");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer claim-bearing-token");
    calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname === "/api/2.0/sql/statements") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.statement, "SELECT agent_id FROM demo_catalog.genie_access.my_genie_agents");
      assert.equal(body.warehouse_id, "befedd56fadee1fa");
      return Response.json({
        status: { state: workspace.directoryState ?? "SUCCEEDED" },
        result: { data_array: workspace.directoryRows ?? [] },
      });
    }
    const id = url.pathname.match(/^\/api\/2\.0\/genie\/spaces\/([^/]+)$/)?.[1] ?? "";
    const space = workspace.spaces?.[id] ?? { status: 404 };
    if (space.status !== 200) return Response.json({ error_code: "RESOURCE_DOES_NOT_EXIST" }, { status: space.status });
    return Response.json({ space_id: id, title: space.title, description: space.description });
  };
  return calls;
}

test("lists the Agents the directory returns for this claim, titled by their Genie spaces", async (context) => {
  fakeWorkspace(context, {
    directoryRows: [[medicalAgent], [heorAgent]],
    spaces: {
      [heorAgent]: { status: 200, title: "HEOR Cohort Explorer", description: "Survival and cost of care" },
      [medicalAgent]: { status: 200, title: "Field Medical Insights" },
    },
  });
  assert.deepEqual(await resolveAgents(baseConfig, "claim-bearing-token"), [
    { id: medicalAgent, title: "Field Medical Insights", description: null },
    { id: heorAgent, title: "HEOR Cohort Explorer", description: "Survival and cost of care" },
  ]);
});

test("returns no Agents when the claim has no roles", async (context) => {
  fakeWorkspace(context, { directoryRows: [] });
  assert.deepEqual(await resolveAgents(baseConfig, "claim-bearing-token"), []);
});

test("leaves out an entitled Agent the service principal cannot open", async (context) => {
  fakeWorkspace(context, {
    directoryRows: [[heorAgent], [medicalAgent]],
    spaces: { [heorAgent]: { status: 200, title: "HEOR Cohort Explorer" }, [medicalAgent]: { status: 403 } },
  });
  assert.deepEqual((await resolveAgents(baseConfig, "claim-bearing-token")).map((agent) => agent.id), [heorAgent]);
});

test("ignores malformed and duplicate Agent IDs from the directory", async (context) => {
  const calls = fakeWorkspace(context, {
    directoryRows: [[heorAgent], [heorAgent], ["../../oidc"], [null], "not-a-row"],
    spaces: { [heorAgent]: { status: 200, title: "HEOR Cohort Explorer" } },
  });
  assert.deepEqual((await resolveAgents(baseConfig, "claim-bearing-token")).map((agent) => agent.id), [heorAgent]);
  assert.deepEqual(calls, ["POST /api/2.0/sql/statements", `GET /api/2.0/genie/spaces/${heorAgent}`]);
});

test("keeps at most the session limit of Agents", async (context) => {
  const ids = Array.from({ length: MAX_AGENTS + 5 }, (_, index) => `01f1agent${String(index).padStart(4, "0")}`);
  fakeWorkspace(context, {
    directoryRows: ids.map((id) => [id]),
    spaces: Object.fromEntries(ids.map((id) => [id, { status: 200, title: id }])),
  });
  assert.equal((await resolveAgents(baseConfig, "claim-bearing-token")).length, MAX_AGENTS);
});

test("fails closed when the directory query does not succeed", async (context) => {
  fakeWorkspace(context, { directoryState: "FAILED" });
  await assert.rejects(resolveAgents(baseConfig, "claim-bearing-token"), /agent_directory_unavailable/);
});

test("reads the directory for every session but caches space titles", async (context) => {
  const calls = fakeWorkspace(context, {
    directoryRows: [[heorAgent]],
    spaces: { [heorAgent]: { status: 200, title: "HEOR Cohort Explorer" } },
  });
  await resolveAgents(baseConfig, "claim-bearing-token");
  await resolveAgents(baseConfig, "claim-bearing-token");
  assert.deepEqual(calls, [
    "POST /api/2.0/sql/statements",
    `GET /api/2.0/genie/spaces/${heorAgent}`,
    "POST /api/2.0/sql/statements",
  ]);
});

test("offers the one fixed Agent to everyone without a directory", async (context) => {
  const calls = fakeWorkspace(context, { spaces: { [heorAgent]: { status: 200, title: "HEOR Cohort Explorer" } } });
  const agents = await resolveAgents({ ...baseConfig, agentSource: { kind: "fixed", agentId: heorAgent } }, "claim-bearing-token");
  assert.deepEqual(agents.map((agent) => agent.id), [heorAgent]);
  assert.deepEqual(calls, [`GET /api/2.0/genie/spaces/${heorAgent}`]);
});
