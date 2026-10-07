import assert from "node:assert/strict";
import test from "node:test";
import functions, { type HttpResponseInit } from "@azure/functions";
import { forwardToBroker } from "./broker.js";

const { HttpRequest } = functions;

Object.assign(process.env, {
  DBX_WORKSPACE_HOST: "workspace.example.com",
  DBX_GENIE_AGENT_ID: "01f1b7b1764a1a04adc67a648599a233",
  DBX_SP_CLIENT_ID: "service-principal-client-id",
  DBX_SP_CLIENT_SECRET: "service-principal-client-secret",
  STATE_ENCRYPTION_SECRET: "this-is-a-test-secret-with-more-than-thirty-two-bytes",
  ALLOWED_PARENT_ORIGINS: "https://caller.example.com",
});

function unsignedJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

async function bodyText(response: HttpResponseInit): Promise<string> {
  return new Response(response.body as ReadableStream).text();
}

test("forwards a GET to the Express app and returns its status, headers, and body", async () => {
  const response = await forwardToBroker(new HttpRequest({ method: "GET", url: "https://broker.example.com/health" }));
  assert.equal(response.status, 200);
  assert.equal((response.headers as Record<string, string>)["cache-control"], "no-store");
  assert.deepEqual(JSON.parse(await bodyText(response)), {
    ok: true,
    authorizationMode: "service_principal",
    dataScope: "identity_claim",
  });
});

test("forwards the Authorization header so the broker can reject a missing or expired Ping token", async () => {
  const missing = await forwardToBroker(new HttpRequest({ method: "POST", url: "https://broker.example.com/api/session" }));
  assert.equal(missing.status, 401);
  assert.deepEqual(JSON.parse(await bodyText(missing)), { error: "missing_bearer_token" });

  const expired = await forwardToBroker(new HttpRequest({
    method: "POST",
    url: "https://broker.example.com/api/session",
    headers: { authorization: `Bearer ${unsignedJwt({ sub: "rep-001", exp: 1 })}` },
  }));
  assert.equal(expired.status, 401);
  assert.deepEqual(JSON.parse(await bodyText(expired)), { error: "bearer_token_expired" });
});

test("forwards the request body to the Express app", async () => {
  const response = await forwardToBroker(new HttpRequest({
    method: "POST",
    url: "https://broker.example.com/api/genie/chat/start",
    headers: { "content-type": "application/json" },
    body: { string: "{not json" },
  }));
  // express.json() rejects the malformed body before any route runs, which only
  // happens when the body actually reached the app.
  assert.equal(response.status, 400);
});

test("accepts a function-key request and returns no hop-by-hop response headers", async () => {
  const response = await forwardToBroker(new HttpRequest({
    method: "GET",
    url: "https://broker.example.com/health?probe=1",
    headers: { "x-functions-key": "kong-function-key", connection: "keep-alive" },
  }));
  assert.equal(response.status, 200);
  const headers = response.headers as Record<string, string>;
  assert.equal(headers.connection, undefined);
  assert.equal(headers["transfer-encoding"], undefined);
});
