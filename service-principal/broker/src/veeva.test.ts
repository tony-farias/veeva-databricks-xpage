import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { BrokerConfig } from "./config.js";
import { verifyVaultIdentity } from "./veeva.js";

const baseConfig: BrokerConfig = {
  workspaceHost: "workspace.example.com",
  genieAgentId: "01f1b7b1764a1a04adc67a648599a233",
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

const currentUser = {
  responseStatus: "SUCCESS",
  users: [{
    user: {
      id: 61579,
      user_name__v: "Vault-Alias@Example.com",
      user_first_name__v: "Person",
      user_last_name__v: "Example",
    },
  }],
};

async function vault(
  context: test.TestContext,
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<string> {
  const server = createServer((req, res) => {
    assert.equal(req.method, "GET");
    assert.equal(req.headers.authorization, "vault-session-value-123");
    res.setHeader("Content-Type", "application/json");
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test("derives the identity claim from the verified Vault username", async (context) => {
  const requests: string[] = [];
  const origin = await vault(context, (req, res) => {
    requests.push(req.url ?? "");
    res.end(JSON.stringify(currentUser));
  });

  const actor = await verifyVaultIdentity("vault-session-value-123", origin, {
    ...baseConfig,
    veevaVaultOrigins: new Set([origin]),
  });
  assert.deepEqual(actor, {
    userName: "Vault-Alias@Example.com",
    displayName: "Person Example",
    subject: "61579",
    identityClaim: "vault-alias@example.com",
    identityClaimSource: "user_name",
  });
  assert.deepEqual(requests, ["/api/v26.1/objects/users/me"]);
});

test("derives the identity claim from federated_id__sys when configured", async (context) => {
  const requests: string[] = [];
  const origin = await vault(context, (req, res) => {
    requests.push(req.url ?? "");
    if (req.url === "/api/v26.1/objects/users/me") {
      res.end(JSON.stringify(currentUser));
      return;
    }
    res.end(JSON.stringify({
      responseStatus: "SUCCESS",
      data: { id: "61579", federated_id__sys: " Person@Example.com " },
    }));
  });

  const actor = await verifyVaultIdentity("vault-session-value-123", origin, {
    ...baseConfig,
    identityClaimSource: "federated_id",
    veevaVaultOrigins: new Set([origin]),
  });
  assert.equal(actor.userName, "Vault-Alias@Example.com");
  assert.equal(actor.identityClaim, "person@example.com");
  assert.equal(actor.identityClaimSource, "federated_id");
  assert.deepEqual(requests, [
    "/api/v26.1/objects/users/me",
    "/api/v26.1/vobjects/user__sys/61579",
  ]);
});

test("refuses a session when the configured federated ID is missing", async (context) => {
  const origin = await vault(context, (req, res) => {
    if (req.url === "/api/v26.1/objects/users/me") {
      res.end(JSON.stringify(currentUser));
      return;
    }
    res.end(JSON.stringify({ responseStatus: "SUCCESS", data: { id: "61579", federated_id__sys: "" } }));
  });

  await assert.rejects(
    verifyVaultIdentity("vault-session-value-123", origin, {
      ...baseConfig,
      identityClaimSource: "federated_id",
      veevaVaultOrigins: new Set([origin]),
    }),
    /identity_claim_unavailable/,
  );
});

test("does not treat a forbidden user-record lookup as an invalid session", async (context) => {
  const origin = await vault(context, (req, res) => {
    if (req.url === "/api/v26.1/objects/users/me") {
      res.end(JSON.stringify(currentUser));
      return;
    }
    res.statusCode = 403;
    res.end(JSON.stringify({ responseStatus: "FAILURE" }));
  });

  await assert.rejects(
    verifyVaultIdentity("vault-session-value-123", origin, {
      ...baseConfig,
      identityClaimSource: "federated_id",
      veevaVaultOrigins: new Set([origin]),
    }),
    /vault_identity_unavailable/,
  );
});

test("rejects an invalid Vault session", async (context) => {
  const origin = await vault(context, (_req, res) => {
    res.end(JSON.stringify({ responseStatus: "FAILURE", errors: [{ type: "INVALID_SESSION_ID" }] }));
  });

  await assert.rejects(
    verifyVaultIdentity("vault-session-value-123", origin, { ...baseConfig, veevaVaultOrigins: new Set([origin]) }),
    /invalid_vault_session/,
  );
});

test("rejects Vault URLs outside the configured allowlist", async () => {
  await assert.rejects(
    verifyVaultIdentity("vault-session-value-123", "https://other-vault.example.com", baseConfig),
    /vault_origin_not_allowed/,
  );
});
