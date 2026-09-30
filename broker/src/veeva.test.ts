import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { BrokerConfig } from "./config.js";
import { verifyVaultSession } from "./veeva.js";

const baseConfig: BrokerConfig = {
  workspaceHost: "workspace.example.com",
  genieAgentId: "01f1b7b1764a1a04adc67a648599a233",
  federatedTokenIssuer: "https://idp.example.com/oauth2/default",
  federatedTokenAudiences: new Set(["veeva-xpage"]),
  federatedUsernameClaim: "email",
  veevaVaultOrigins: new Set(["https://vault.example.com"]),
  veevaVaultApiVersion: "v26.1",
  brokerSessionTtlMs: 900_000,
  stateSecret: "this-is-a-test-secret-with-more-than-thirty-two-bytes",
  allowedParentOrigins: new Set(["https://vault.example.com"]),
  allowOpaqueParentOrigin: false,
  allowVeevaParentOrigins: false,
  port: 8787,
};

test("verifies the native Vault session and resolves the current human user", async (context) => {
  const server = createServer((req, res) => {
    assert.equal(req.method, "GET");
    assert.equal(req.url, "/api/v26.1/objects/users/me");
    assert.equal(req.headers.authorization, "vault-session-value-123");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      responseStatus: "SUCCESS",
      users: [{
        user: {
          id: 61579,
          user_name__v: "person@example.com",
          user_first_name__v: "Person",
          user_last_name__v: "Example",
        },
      }],
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;
  const actor = await verifyVaultSession(
    "vault-session-value-123",
    origin,
    { ...baseConfig, veevaVaultOrigins: new Set([origin]) },
  );
  assert.deepEqual(actor, {
    userName: "person@example.com",
    displayName: "Person Example",
    subject: "61579",
  });
});

test("rejects Vault URLs outside the server-side allowlist", async () => {
  await assert.rejects(
    verifyVaultSession("vault-session-value-123", "https://other-vault.example.com", baseConfig),
    /vault_origin_not_allowed/,
  );
});

test("rejects malformed Vault session identifiers", async () => {
  await assert.rejects(
    verifyVaultSession("short", "https://vault.example.com", baseConfig),
    /invalid_vault_session/,
  );
});
