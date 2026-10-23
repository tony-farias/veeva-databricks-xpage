import assert from "node:assert/strict";
import test from "node:test";
import { canonicalIdentityClaim } from "./identity.js";

test("canonicalizes identity claims to one lowercase spelling", () => {
  assert.equal(canonicalIdentityClaim("  Person@Example.com "), "person@example.com");
});

test("refuses empty or ambiguous identity claims", () => {
  for (const value of ["", "   ", "two words@example.com", "tab\tseparated", "ünicode@example.com", "a".repeat(257)]) {
    assert.equal(canonicalIdentityClaim(value), null, JSON.stringify(value));
  }
});
