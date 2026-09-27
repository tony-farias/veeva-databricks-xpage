import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "./config.js";

const baseEnv: NodeJS.ProcessEnv = {
  DBX_WORKSPACE_HOST: "workspace.example.com",
  DBX_GENIE_SPACE_ID: "01f1b7b1764a1a04adc67a648599a233",
  VEEVA_SSO_ISSUER: "https://login.example.com/tenant/v2.0",
  VEEVA_SSO_AUDIENCE: "veeva-xpage-client-id",
  DBX_CLIENT_ID: "client-id",
  DBX_CLIENT_SECRET: "client-secret",
  DBX_REDIRECT_URI: "https://broker.example.com/auth/callback",
  DBX_GENIE_REDIRECT_URL: "https://workspace.example.com/genie/rooms/room-id?o=123",
  STATE_ENCRYPTION_SECRET: "this-is-a-test-secret-with-more-than-thirty-two-bytes",
  ALLOWED_PARENT_ORIGINS: "https://vault.example.com",
};

test("accepts a fixed Genie redirect on the configured workspace", () => {
  assert.equal(loadConfig(baseEnv).genieRedirectUrl, "https://workspace.example.com/genie/rooms/room-id?o=123");
  assert.equal(loadConfig(baseEnv).genieSpaceId, "01f1b7b1764a1a04adc67a648599a233");
});

test("requires an HTTPS Veeva SSO issuer", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, VEEVA_SSO_ISSUER: "http://login.example.com/tenant/v2.0" }),
    /must use HTTPS/,
  );
});

test("rejects an iOS redirect to another host", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, DBX_GENIE_REDIRECT_URL: "https://attacker.example/genie/rooms/room-id" }),
    /must be an HTTPS URL on DBX_WORKSPACE_HOST/,
  );
});

test("rejects a same-workspace redirect outside Genie rooms", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, DBX_GENIE_REDIRECT_URL: "https://workspace.example.com/other" }),
    /must point to a full Genie room/,
  );
});
