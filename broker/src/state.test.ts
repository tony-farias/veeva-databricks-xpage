import assert from "node:assert/strict";
import test from "node:test";
import { openState, sealState, type AuthState } from "./state.js";

const secret = "this-is-a-test-secret-with-more-than-thirty-two-bytes";
const state: AuthState = {
  verifier: "verifier",
  carrier: "iframe",
  parentOrigin: "https://vault.example.com",
  channelId: "abc12345",
  expiresAt: 2_000,
};

test("round trips encrypted OAuth state", () => {
  assert.deepEqual(openState(sealState(state, secret), secret, 1_000), state);
});

test("round trips an iOS redirect state without popup routing fields", () => {
  const redirectState: AuthState = {
    verifier: "redirect-verifier",
    carrier: "redirect",
    expiresAt: 2_000,
  };
  assert.deepEqual(openState(sealState(redirectState, secret), secret, 1_000), redirectState);
});

test("rejects expired OAuth state", () => {
  assert.throws(() => openState(sealState(state, secret), secret, 2_001), /invalid_state/);
});

test("rejects modified OAuth state", () => {
  const sealed = sealState(state, secret);
  const parts = sealed.split(".");
  const ciphertext = parts[2]!;
  parts[2] = `${ciphertext.startsWith("a") ? "b" : "a"}${ciphertext.slice(1)}`;
  const modified = parts.join(".");
  assert.throws(() => openState(modified, secret, 1_000), /invalid_state/);
});
