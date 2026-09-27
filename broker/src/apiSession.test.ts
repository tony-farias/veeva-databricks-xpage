import assert from "node:assert/strict";
import test from "node:test";
import { openApiSession, sealApiSession, type ApiSession } from "./apiSession.js";

const secret = "this-is-a-test-secret-with-more-than-thirty-two-bytes";
const session: ApiSession = {
  accessToken: "sensitive-databricks-token",
  userName: "person@example.com",
  displayName: "Person Example",
  expiresAt: 2_000,
};

test("round trips an encrypted user API session", () => {
  assert.deepEqual(openApiSession(sealApiSession(session, secret), secret, 1_000), session);
});

test("does not expose the Databricks token in the sealed value", () => {
  assert.equal(sealApiSession(session, secret).includes(session.accessToken), false);
});

test("rejects an expired user API session", () => {
  assert.throws(() => openApiSession(sealApiSession(session, secret), secret, 2_001), /invalid_session/);
});
