import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";
import { rateLimitKey } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig({
  DBX_WORKSPACE_HOST: "workspace.example.com",
  DBX_GENIE_AGENT_ID: "01f1b7b1764a1a04adc67a648599a233",
  DBX_SP_CLIENT_ID: "service-principal-client-id",
  DBX_SP_CLIENT_SECRET: "service-principal-client-secret",
  STATE_ENCRYPTION_SECRET: "this-is-a-test-secret-with-more-than-thirty-two-bytes",
  ALLOWED_PARENT_ORIGINS: "https://caller.example.com",
});

function request(authorization: string | undefined, ip = "203.0.113.7"): Request {
  return { ip, header: (name: string) => (name.toLowerCase() === "authorization" ? authorization : undefined) } as Request;
}

function bearer(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `Bearer ${encode({ alg: "RS256" })}.${encode(payload)}.signature`;
}

test("rate limits are counted per identity claim, so reps behind one gateway IP do not share a budget", () => {
  assert.equal(rateLimitKey(request(bearer({ sub: "REP-001" })), config), "claim:rep-001");
  assert.equal(rateLimitKey(request(bearer({ sub: "rep-002" })), config), "claim:rep-002");
});

test("requests without a usable Ping token fall back to the client IP", () => {
  assert.equal(rateLimitKey(request(undefined), config), "ip:203.0.113.7");
  assert.equal(rateLimitKey(request(bearer({ sub: "rep-001", exp: 1 })), config), "ip:203.0.113.7");
});
