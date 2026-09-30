import assert from "node:assert/strict";
import test from "node:test";
import { proxyClientIp } from "./network.js";

test("removes the source port Azure adds to forwarded IPv4 addresses", () => {
  assert.equal(proxyClientIp("75.125.237.21:54261"), "75.125.237.21");
});

test("normalizes bracketed IPv6 proxy addresses and preserves plain addresses", () => {
  assert.equal(proxyClientIp("[2001:db8::1]:443"), "2001:db8::1");
  assert.equal(proxyClientIp("2001:db8::1"), "2001:db8::1");
  assert.equal(proxyClientIp("127.0.0.1"), "127.0.0.1");
  assert.equal(proxyClientIp(undefined), "unknown");
});
