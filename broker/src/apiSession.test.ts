import assert from "node:assert/strict";
import test from "node:test";
import { openApiSession, sealApiSession, type ApiSession } from "./apiSession.js";

const secret = "this-is-a-test-secret-with-more-than-thirty-two-bytes";
const session: ApiSession = {
  accessToken: "sensitive-databricks-token",
  actorUserName: "person@example.com",
  actorDisplayName: "Person Example",
  actorSubject: "61579",
  externalUserName: "person@example.com",
  databricksUserName: "person@example.com",
  databricksDisplayName: "Person Example",
  sessionId: "74d7c9b9-1b32-4d77-9eb7-59118c2c1053",
  expiresAt: 2_000,
};

test("round trips an encrypted federated-user API session", () => {
  assert.deepEqual(openApiSession(sealApiSession(session, secret), secret, 1_000), session);
});

test("does not expose tokens or user identities in the sealed value", () => {
  const sealed = sealApiSession(session, secret);
  assert.equal(sealed.includes(session.accessToken), false);
  assert.equal(sealed.includes(session.actorUserName), false);
});

test("rejects an expired federated-user API session", () => {
  assert.throws(() => openApiSession(sealApiSession(session, secret), secret, 2_001), /invalid_session/);
});
