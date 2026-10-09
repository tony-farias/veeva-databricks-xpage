import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { BrokerConfig } from "./config.js";
import { verifySalesforceIdentity } from "./salesforce.js";

const SESSION_ID = "00D5g000004XyZa!AQEAQSessionValue.123";
const USER_ID = "0055g00000Ab1CdAAJ";

const baseConfig: BrokerConfig = {
  workspaceHost: "workspace.example.com",
  genieAgentId: "01f1b7b1764a1a04adc67a648599a233",
  salesforceOrigins: new Set(["https://crm.example.my.salesforce.com"]),
  salesforceOrgIds: new Set(["00D5g000004XyZa"]),
  salesforceApiVersion: "v62.0",
  identityClaimSource: "username",
  servicePrincipalClientId: "service-principal-client-id",
  servicePrincipalClientSecret: "service-principal-client-secret",
  servicePrincipalDisplayName: "shared-genie-runtime",
  servicePrincipalOauthScope: "all-apis",
  brokerSessionTtlMs: 900_000,
  stateSecret: "this-is-a-test-secret-with-more-than-thirty-two-bytes",
  allowedParentOrigins: new Set(["https://crm.example--c.vf.force.com"]),
  allowOpaqueParentOrigin: false,
  allowSalesforceParentOrigins: false,
  port: 8787,
};

function userInfoResponse(overrides: Record<string, string> = {}): string {
  const fields = {
    organizationId: "00D5g000004XyZaEAK",
    userFullName: "Person &amp; Example",
    userId: USER_ID,
    userName: "Rep.Alias@Example.com",
    ...overrides,
  };
  const elements = Object.entries(fields).map(([name, value]) => `<${name}>${value}</${name}>`).join("");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns="urn:partner.soap.sforce.com">',
    `<soapenv:Body><getUserInfoResponse><result><accessibilityMode>false</accessibilityMode>${elements}</result></getUserInfoResponse></soapenv:Body>`,
    "</soapenv:Envelope>",
  ].join("");
}

const invalidSessionFault = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sf="urn:fault.partner.soap.sforce.com">',
  "<soapenv:Body><soapenv:Fault><faultcode>sf:INVALID_SESSION_ID</faultcode>",
  "<faultstring>INVALID_SESSION_ID: Invalid Session ID found in SessionHeader</faultstring></soapenv:Fault></soapenv:Body>",
  "</soapenv:Envelope>",
].join("");

interface SeenRequest {
  method: string;
  url: string;
  body: string;
  authorization?: string;
}

async function salesforce(
  context: test.TestContext,
  handler: (req: SeenRequest, res: ServerResponse) => void,
): Promise<{ origin: string; requests: SeenRequest[] }> {
  const requests: SeenRequest[] = [];
  const server = createServer((req: IncomingMessage, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const seen = { method: req.method ?? "", url: req.url ?? "", body, authorization: req.headers.authorization };
      requests.push(seen);
      handler(seen, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

test("derives the identity claim from the session's Salesforce username", async (context) => {
  const { origin, requests } = await salesforce(context, (_req, res) => {
    res.setHeader("Content-Type", "text/xml");
    res.end(userInfoResponse());
  });

  const actor = await verifySalesforceIdentity(SESSION_ID, origin, {
    ...baseConfig,
    salesforceOrigins: new Set([origin]),
  });
  assert.deepEqual(actor, {
    userName: "Rep.Alias@Example.com",
    displayName: "Person & Example",
    subject: USER_ID,
    organizationId: "00D5g000004XyZaEAK",
    identityClaim: "rep.alias@example.com",
    identityClaimSource: "username",
  });
  const [soap, ...rest] = requests;
  assert.ok(soap);
  assert.equal(rest.length, 0);
  assert.equal(soap.method, "POST");
  assert.equal(soap.url, "/services/Soap/u/62.0");
  assert.match(soap.body, /<urn:sessionId>00D5g000004XyZa!AQEAQSessionValue\.123<\/urn:sessionId>/);
  assert.match(soap.body, /<urn:getUserInfo\/>/);
});

test("derives the identity claim from FederationIdentifier when configured", async (context) => {
  const { origin, requests } = await salesforce(context, (req, res) => {
    if (req.method === "POST") {
      res.end(userInfoResponse());
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ attributes: { type: "User" }, Id: USER_ID, FederationIdentifier: " Person@Example.com " }));
  });

  const actor = await verifySalesforceIdentity(SESSION_ID, origin, {
    ...baseConfig,
    identityClaimSource: "federation_id",
    salesforceOrigins: new Set([origin]),
  });
  assert.equal(actor.userName, "Rep.Alias@Example.com");
  assert.equal(actor.identityClaim, "person@example.com");
  assert.equal(actor.identityClaimSource, "federation_id");
  const record = requests[1];
  assert.ok(record);
  assert.equal(record.url, `/services/data/v62.0/sobjects/User/${USER_ID}?fields=Id%2CFederationIdentifier`);
  assert.equal(record.authorization, `Bearer ${SESSION_ID}`);
});

test("refuses a session when the configured Federation ID is missing", async (context) => {
  const { origin } = await salesforce(context, (req, res) => {
    if (req.method === "POST") {
      res.end(userInfoResponse());
      return;
    }
    res.end(JSON.stringify({ Id: USER_ID, FederationIdentifier: null }));
  });

  await assert.rejects(
    verifySalesforceIdentity(SESSION_ID, origin, {
      ...baseConfig,
      identityClaimSource: "federation_id",
      salesforceOrigins: new Set([origin]),
    }),
    /identity_claim_unavailable/,
  );
});

test("does not treat a forbidden user-record lookup as an invalid session", async (context) => {
  const { origin } = await salesforce(context, (req, res) => {
    if (req.method === "POST") {
      res.end(userInfoResponse());
      return;
    }
    res.statusCode = 403;
    res.end(JSON.stringify([{ errorCode: "INSUFFICIENT_ACCESS" }]));
  });

  await assert.rejects(
    verifySalesforceIdentity(SESSION_ID, origin, {
      ...baseConfig,
      identityClaimSource: "federation_id",
      salesforceOrigins: new Set([origin]),
    }),
    /salesforce_identity_unavailable/,
  );
});

test("rejects a session from an organization outside the allowlist", async (context) => {
  const { origin } = await salesforce(context, (_req, res) => {
    res.end(userInfoResponse({ organizationId: "00D3x000001AbCdEAK" }));
  });

  await assert.rejects(
    verifySalesforceIdentity(SESSION_ID, origin, { ...baseConfig, salesforceOrigins: new Set([origin]) }),
    /salesforce_org_not_allowed/,
  );
});

test("rejects an invalid Salesforce session", async (context) => {
  const { origin } = await salesforce(context, (_req, res) => {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/xml");
    res.end(invalidSessionFault);
  });

  await assert.rejects(
    verifySalesforceIdentity(SESSION_ID, origin, { ...baseConfig, salesforceOrigins: new Set([origin]) }),
    /invalid_salesforce_session/,
  );
});

test("rejects a response that does not identify a Salesforce user", async (context) => {
  const { origin } = await salesforce(context, (_req, res) => {
    res.end(userInfoResponse({ userId: "not-a-user-id" }));
  });

  await assert.rejects(
    verifySalesforceIdentity(SESSION_ID, origin, { ...baseConfig, salesforceOrigins: new Set([origin]) }),
    /salesforce_identity_unavailable/,
  );
});

test("escapes the session ID inside the SOAP envelope", async (context) => {
  const { origin, requests } = await salesforce(context, (_req, res) => {
    res.end(userInfoResponse());
  });

  await verifySalesforceIdentity("00D5g000004XyZa!AQ<injected/>&more", origin, {
    ...baseConfig,
    salesforceOrigins: new Set([origin]),
  });
  assert.match(requests[0]?.body ?? "", /<urn:sessionId>00D5g000004XyZa!AQ&lt;injected\/&gt;&amp;more<\/urn:sessionId>/);
});

test("rejects instance URLs outside the configured allowlist", async () => {
  await assert.rejects(
    verifySalesforceIdentity(SESSION_ID, "https://other.my.salesforce.com", baseConfig),
    /salesforce_origin_not_allowed/,
  );
});
