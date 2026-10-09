import type { BrokerConfig, IdentityClaimSource } from "./config.js";
import { canonicalIdentityClaim } from "./identity.js";

export interface SalesforceActorIdentity {
  userName: string;
  displayName: string | null;
  subject: string;
  organizationId: string;
  identityClaim: string;
  identityClaimSource: IdentityClaimSource;
}

export class SalesforceError extends Error {
  constructor(readonly code: string, readonly status = 502) {
    super(code);
  }
}

export async function verifySalesforceIdentity(
  sessionId: string,
  instanceUrl: string,
  config: BrokerConfig,
): Promise<SalesforceActorIdentity> {
  if (!/^[\x21-\x7e]{16,8192}$/.test(sessionId)) {
    throw new SalesforceError("invalid_salesforce_session", 401);
  }

  let origin: string;
  try {
    origin = new URL(instanceUrl).origin;
  } catch {
    throw new SalesforceError("salesforce_origin_not_allowed", 403);
  }
  if (!config.salesforceOrigins.has(origin)) {
    throw new SalesforceError("salesforce_origin_not_allowed", 403);
  }

  const user = await currentSalesforceUser(sessionId, origin, config);
  // Pod hostnames are shared between customers, so the instance allowlist alone
  // does not prove the session belongs to the customer's org.
  if (!config.salesforceOrgIds.has(user.organizationId.slice(0, 15))) {
    throw new SalesforceError("salesforce_org_not_allowed", 403);
  }

  const claimSourceValue = config.identityClaimSource === "federation_id"
    ? await retrieveFederationId(sessionId, origin, user.userId, config)
    : user.userName;
  const identityClaim = claimSourceValue ? canonicalIdentityClaim(claimSourceValue) : null;
  if (!identityClaim) throw new SalesforceError("identity_claim_unavailable", 403);

  return {
    userName: user.userName,
    displayName: user.displayName,
    subject: user.userId,
    organizationId: user.organizationId,
    identityClaim,
    identityClaimSource: config.identityClaimSource,
  };
}

interface SessionUser {
  userId: string;
  organizationId: string;
  userName: string;
  displayName: string | null;
}

// Salesforce's OAuth userinfo endpoint can reject UI session IDs, which is what
// getSFDCSessionID() returns. SOAP getUserInfo() accepts any API-enabled session.
async function currentSalesforceUser(
  sessionId: string,
  origin: string,
  config: BrokerConfig,
): Promise<SessionUser> {
  const envelope = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:partner.soap.sforce.com">',
    `<env:Header><urn:SessionHeader><urn:sessionId>${escapeXml(sessionId)}</urn:sessionId></urn:SessionHeader></env:Header>`,
    "<env:Body><urn:getUserInfo/></env:Body>",
    "</env:Envelope>",
  ].join("");

  let response: Response;
  let body: string;
  try {
    response = await fetch(new URL(`/services/Soap/u/${config.salesforceApiVersion.slice(1)}`, origin), {
      method: "POST",
      headers: {
        Accept: "text/xml",
        "Content-Type": "text/xml; charset=UTF-8",
        SOAPAction: '""',
      },
      body: envelope,
      signal: AbortSignal.timeout(15_000),
    });
    body = await response.text();
  } catch {
    throw new SalesforceError("salesforce_identity_unavailable", 502);
  }

  if (response.status === 401 || xmlElement(body, "faultcode")?.endsWith("INVALID_SESSION_ID")) {
    throw new SalesforceError("invalid_salesforce_session", 401);
  }
  if (!response.ok || !body.includes("getUserInfoResponse")) {
    throw new SalesforceError("salesforce_identity_unavailable", 502);
  }

  const userId = xmlElement(body, "userId") ?? "";
  const organizationId = xmlElement(body, "organizationId") ?? "";
  const userName = xmlElement(body, "userName") ?? "";
  if (!isSalesforceId(userId, "005") || !isSalesforceId(organizationId, "00D") || !userName) {
    throw new SalesforceError("salesforce_identity_unavailable", 502);
  }
  return { userId, organizationId, userName, displayName: xmlElement(body, "userFullName") || null };
}

async function retrieveFederationId(
  sessionId: string,
  origin: string,
  userId: string,
  config: BrokerConfig,
): Promise<string | null> {
  const url = new URL(`/services/data/${config.salesforceApiVersion}/sobjects/User/${userId}`, origin);
  url.searchParams.set("fields", "Id,FederationIdentifier");

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${sessionId}`,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new SalesforceError("salesforce_identity_unavailable", 502);
  }
  // getUserInfo has already accepted the session, so a 403 or 404 here means
  // the user cannot read the field, not that the session is unusable.
  if (response.status === 401) throw new SalesforceError("invalid_salesforce_session", 401);
  if (!response.ok) throw new SalesforceError("salesforce_identity_unavailable", 502);

  const record = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (record.Id !== userId) throw new SalesforceError("salesforce_identity_unavailable", 502);
  return typeof record.FederationIdentifier === "string" && record.FederationIdentifier.trim()
    ? record.FederationIdentifier.trim()
    : null;
}

function isSalesforceId(value: string, prefix: string): boolean {
  return value.startsWith(prefix) && /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(value);
}

// getUserInfoResponse carries flat, single-valued elements, so a namespace-aware
// match on the element name is enough; no XML dependency is needed.
function xmlElement(xml: string, name: string): string | undefined {
  const pattern = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:[A-Za-z_][\\w.-]*:)?${name}>`);
  const match = xml.match(pattern);
  return match?.[1] === undefined ? undefined : decodeXml(match[1]).trim();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (entity, code: string) => {
    const lower = code.toLowerCase();
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "amp") return "&";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    const point = lower.startsWith("#x") ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
    return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
}
