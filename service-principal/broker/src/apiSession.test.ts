import assert from "node:assert/strict";
import test from "node:test";
import { openApiSession, sealApiSession, type ApiSession } from "./apiSession.js";

const secret = "this-is-a-test-secret-with-more-than-thirty-two-bytes";
const session: ApiSession = {
  accessToken: "sensitive-service-principal-token",
  actorUserName: "person@example.com",
  actorDisplayName: "Person Example",
  identityClaim: "person@example.com",
  identityClaimSource: "federated_id",
  executionApplicationId: "service-principal-client-id",
  executionDisplayName: "shared-genie-runtime",
  sessionId: "74d7c9b9-1b32-4d77-9eb7-59118c2c1053",
  expiresAt: 2_000,
};

test("round trips an encrypted shared-identity API session", () => {
  assert.deepEqual(openApiSession(sealApiSession(session, secret), secret, 1_000), session);
});

test("does not expose the Databricks token, Veeva user, or identity claim in the sealed value", () => {
  const sealed = sealApiSession(session, secret);
  assert.equal(sealed.includes(session.accessToken), false);
  assert.equal(sealed.includes(session.actorUserName), false);
  assert.equal(sealed.includes(session.identityClaim), false);
});

test("rejects sessions sealed before identity claims were required", () => {
  const sealed = sealApiSession(session, secret);
  assert.throws(() => openApiSession(sealed.replace(/^sp2\./, "sp1."), secret, 1_000), /invalid_session/);
});

test("rejects a session without an identity claim", () => {
  const sealed = sealApiSession({ ...session, identityClaim: "" }, secret);
  assert.throws(() => openApiSession(sealed, secret, 1_000), /invalid_session/);
});

test("rejects an expired shared-identity API session", () => {
  assert.throws(() => openApiSession(sealApiSession(session, secret), secret, 2_001), /invalid_session/);
});
