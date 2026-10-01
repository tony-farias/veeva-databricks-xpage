import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { BrokerConfig } from "./config.js";
import { verifyVaultIdentity } from "./veeva.js";

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

test("uses user_name__v without requesting the user record when it matches", async (context) => {
  let requests = 0;
  const server = createServer((req, res) => {
    requests += 1;
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
  const actor = await verifyVaultIdentity(
    "vault-session-value-123",
    origin,
    " Person@Example.com ",
    { ...baseConfig, veevaVaultOrigins: new Set([origin]) },
  );
  assert.deepEqual(actor, {
    userName: "person@example.com",
    displayName: "Person Example",
    subject: "61579",
    authorizationUserName: "person@example.com",
    authorizationSource: "user_name__v",
  });
  assert.equal(requests, 1);
});

test("falls back to federated_id__sys when the Vault username differs", async (context) => {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url ?? "");
    assert.equal(req.method, "GET");
    assert.equal(req.headers.authorization, "vault-session-value-123");
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/v26.1/objects/users/me") {
      res.end(JSON.stringify({
        responseStatus: "SUCCESS",
        users: [{
          user: {
            id: 61579,
            user_name__v: "vault-alias@example.com",
            user_first_name__v: "Person",
            user_last_name__v: "Example",
          },
        }],
      }));
      return;
    }
    assert.equal(req.url, "/api/v26.1/vobjects/user__sys/61579");
    res.end(JSON.stringify({
      responseStatus: "SUCCESS",
      data: {
        id: "61579",
        federated_id__sys: " Person@Example.com ",
      },
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;
  const actor = await verifyVaultIdentity(
    "vault-session-value-123",
    origin,
    "person@example.com",
    { ...baseConfig, veevaVaultOrigins: new Set([origin]) },
  );
  assert.deepEqual(actor, {
    userName: "vault-alias@example.com",
    displayName: "Person Example",
    subject: "61579",
    authorizationUserName: "Person@Example.com",
    authorizationSource: "federated_id__sys",
  });
  assert.deepEqual(requests, [
    "/api/v26.1/objects/users/me",
    "/api/v26.1/vobjects/user__sys/61579",
  ]);
});

test("rejects the session when neither Vault identity matches", async (context) => {
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/v26.1/objects/users/me") {
      res.end(JSON.stringify({
        responseStatus: "SUCCESS",
        users: [{ user: { id: 61579, user_name__v: "vault-alias@example.com" } }],
      }));
      return;
    }
    res.end(JSON.stringify({
      responseStatus: "SUCCESS",
      data: { id: "61579", federated_id__sys: "another@example.com" },
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;
  await assert.rejects(
    verifyVaultIdentity(
      "vault-session-value-123",
      origin,
      "person@example.com",
      { ...baseConfig, veevaVaultOrigins: new Set([origin]) },
    ),
    /identity_mismatch/,
  );
});

test("rejects Vault URLs outside the server-side allowlist", async () => {
  await assert.rejects(
    verifyVaultIdentity(
      "vault-session-value-123",
      "https://other-vault.example.com",
      "person@example.com",
      baseConfig,
    ),
    /vault_origin_not_allowed/,
  );
});

test("rejects malformed Vault session identifiers", async () => {
  await assert.rejects(
    verifyVaultIdentity("short", "https://vault.example.com", "person@example.com", baseConfig),
    /invalid_vault_session/,
  );
});
