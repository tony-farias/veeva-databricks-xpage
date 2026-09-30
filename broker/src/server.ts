import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { openApiSession, sealApiSession, type ApiSession } from "./apiSession.js";
import { loadConfig, type BrokerConfig } from "./config.js";
import {
  DatabricksError,
  databricksFetch,
  exchangeFederatedAssertion,
  sanitizeDatabricksJson,
  workspaceUrl,
} from "./databricks.js";
import { proxyClientIp } from "./network.js";
import { VeevaError, verifyVaultSession } from "./veeva.js";

const config = loadConfig();
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use((_req, res, next) => {
  res.set({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  });
  next();
});
app.use((req, res, next) => applyCors(req, res, next, config));
app.use(express.json({ limit: "32kb" }));

app.get("/health", (_req, res) => res.json({ ok: true, authorizationMode: "federated_user" }));
app.get("/", (_req, res) => res.type("text/plain").send("Vault CRM Genie federated-user broker"));

const sessionLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(proxyClientIp(req.ip)),
});
const genieLimiter = rateLimit({
  windowMs: 60_000,
  limit: 180,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(proxyClientIp(req.ip)),
});

app.post("/api/session", sessionLimiter, (req, res) => createApiSession(req, res, config));
app.get("/api/me", genieLimiter, (req, res) => getApiIdentity(req, res, config));
app.post("/api/genie/chat/start", genieLimiter, (req, res) => startChat(req, res, config));
app.post(
  "/api/genie/chat/conversations/:conversationId/messages",
  genieLimiter,
  (req, res) => continueChat(req, res, config),
);
app.get(
  "/api/genie/chat/conversations/:conversationId/messages/:messageId",
  genieLimiter,
  (req, res) => getChatMessage(req, res, config),
);
app.get(
  "/api/genie/chat/conversations/:conversationId/messages/:messageId/attachments/:attachmentId/query-result",
  genieLimiter,
  (req, res) => getQueryResult(req, res, config),
);
app.get(
  "/api/genie/chat/conversations/:conversationId/messages/:messageId/attachments/:attachmentId/visualization",
  genieLimiter,
  (req, res) => getVisualization(req, res, config),
);
app.post("/api/genie/agent/responses", genieLimiter, (req, res) => streamAgentResponse(req, res, config));
app.get(
  "/api/genie/agent/conversations/:conversationId/items",
  genieLimiter,
  (req, res) => listAgentItems(req, res, config),
);

app.listen(config.port, () => {
  console.log(JSON.stringify({
    event: "broker.started",
    authorizationMode: "federated_user",
    genieAgentId: config.genieAgentId,
    port: config.port,
  }));
});

function applyCors(req: Request, res: Response, next: NextFunction, current: BrokerConfig): void {
  const origin = req.header("Origin");
  if (!origin) {
    next();
    return;
  }
  const allowed = origin === "null"
    ? current.allowOpaqueParentOrigin
    : current.allowedParentOrigins.has(origin)
      || (current.allowVeevaParentOrigins && isVeevaHttpsOrigin(origin));
  if (!allowed) {
    console.warn(JSON.stringify({
      event: "security.origin_rejected",
      timestamp: new Date().toISOString(),
      origin,
      method: req.method,
      path: req.path,
    }));
    res.status(403).json({ error: "origin_not_allowed" });
    return;
  }
  res.set({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Request-ID",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "600",
  });
  res.vary("Origin");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}

async function createApiSession(req: Request, res: Response, current: BrokerConfig): Promise<void> {
  try {
    const assertion = typeof req.body?.assertion === "string" ? req.body.assertion : "";
    const vaultSessionId = typeof req.body?.vaultSessionId === "string" ? req.body.vaultSessionId : "";
    const vaultUrl = typeof req.body?.vaultUrl === "string" ? req.body.vaultUrl : "";
    if (!assertion || !vaultSessionId || !vaultUrl) {
      throw new ApiError("missing_authentication_material", 400);
    }

    const actor = await verifyVaultSession(vaultSessionId, vaultUrl, current);
    const identity = await exchangeFederatedAssertion(assertion, actor.userName, current);
    const expiresAt = Math.min(identity.expiresAt, Date.now() + current.brokerSessionTtlMs);
    if (expiresAt <= Date.now() + 30_000) throw new ApiError("external_token_expired", 401);
    const session: ApiSession = {
      accessToken: identity.accessToken,
      actorUserName: actor.userName,
      actorDisplayName: actor.displayName,
      actorSubject: actor.subject,
      externalUserName: identity.externalUserName,
      databricksUserName: identity.userName,
      databricksDisplayName: identity.displayName,
      sessionId: randomUUID(),
      expiresAt,
    };
    audit("session.created", session, current, requestId(req), {});
    res.json({
      sessionToken: sealApiSession(session, current.stateSecret),
      expiresAt: new Date(expiresAt).toISOString(),
      authorizationMode: "federated_user",
      user: { userName: identity.userName, displayName: identity.displayName },
      actor: { userName: actor.userName, displayName: actor.displayName, subject: actor.subject },
      executionIdentity: {
        userName: identity.userName,
        displayName: identity.displayName,
        externalUserName: identity.externalUserName,
      },
    });
  } catch (error) {
    console.warn(JSON.stringify({
      event: "security.session_rejected",
      timestamp: new Date().toISOString(),
      correlationId: requestId(req),
      origin: req.header("Origin") ?? null,
      error: publicErrorCode(error),
      status: publicErrorStatus(error),
    }));
    sendApiError(res, error);
  }
}

function getApiIdentity(req: Request, res: Response, current: BrokerConfig): void {
  try {
    const session = requireApiSession(req, current);
    res.json({
      authorizationMode: "federated_user",
      user: { userName: session.databricksUserName, displayName: session.databricksDisplayName },
      actor: {
        userName: session.actorUserName,
        displayName: session.actorDisplayName,
        subject: session.actorSubject,
      },
      executionIdentity: {
        userName: session.databricksUserName,
        displayName: session.databricksDisplayName,
        externalUserName: session.externalUserName,
      },
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
  } catch (error) {
    sendApiError(res, error);
  }
}

async function startChat(req: Request, res: Response, current: BrokerConfig): Promise<void> {
  try {
    const session = requireApiSession(req, current);
    const content = parsePrompt(req.body?.content);
    audit("chat.start", session, current, requestId(req), {});
    await proxyJson(res, session, current, `/api/2.0/genie/spaces/${current.genieAgentId}/start-conversation`, {
      method: "POST",
      body: JSON.stringify({ content, enable_visualization: req.body?.enableVisualization !== false }),
    });
  } catch (error) {
    sendApiError(res, error);
  }
}

async function continueChat(req: Request, res: Response, current: BrokerConfig): Promise<void> {
  try {
    const session = requireApiSession(req, current);
    const conversationId = parseIdentifier(req.params.conversationId, "conversation_id");
    const content = parsePrompt(req.body?.content);
    audit("chat.continue", session, current, requestId(req), { conversationId });
    await proxyJson(
      res,
      session,
      current,
      `/api/2.0/genie/spaces/${current.genieAgentId}/conversations/${conversationId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ content, enable_visualization: req.body?.enableVisualization !== false }),
      },
    );
  } catch (error) {
    sendApiError(res, error);
  }
}

async function getChatMessage(req: Request, res: Response, current: BrokerConfig): Promise<void> {
  try {
    const session = requireApiSession(req, current);
    const conversationId = parseIdentifier(req.params.conversationId, "conversation_id");
    const messageId = parseIdentifier(req.params.messageId, "message_id");
    audit("chat.message.read", session, current, requestId(req), { conversationId, messageId });
    await proxyJson(
      res,
      session,
      current,
      `/api/2.0/genie/spaces/${current.genieAgentId}/conversations/${conversationId}/messages/${messageId}`,
    );
  } catch (error) {
    sendApiError(res, error);
  }
}

async function getQueryResult(req: Request, res: Response, current: BrokerConfig): Promise<void> {
  try {
    const session = requireApiSession(req, current);
    const { conversationId, messageId, attachmentId } = parseMessageAttachmentIds(req);
    audit("chat.query_result.read", session, current, requestId(req), { conversationId, messageId, attachmentId });
    await proxyJson(
      res,
      session,
      current,
      `/api/2.0/genie/spaces/${current.genieAgentId}/conversations/${conversationId}/messages/${messageId}/attachments/${attachmentId}/query-result`,
    );
  } catch (error) {
    sendApiError(res, error);
  }
}

async function getVisualization(req: Request, res: Response, current: BrokerConfig): Promise<void> {
  try {
    const session = requireApiSession(req, current);
    const { conversationId, messageId, attachmentId } = parseMessageAttachmentIds(req);
    audit("chat.visualization.read", session, current, requestId(req), { conversationId, messageId, attachmentId });
    const name = `spaces/${current.genieAgentId}/conversations/${conversationId}/messages/${messageId}/attachments/${attachmentId}`;
    const upstream = await databricksFetch(
      workspaceUrl(current, `/api/2.0/genie/${name}/download-visualization`),
      session.accessToken,
    );
    if (!upstream.ok) {
      await sendUpstreamFailure(res, upstream);
      return;
    }
    const data = Buffer.from(await upstream.arrayBuffer());
    res.status(200).set({
      "Content-Type": upstream.headers.get("content-type") || "image/png",
      "Content-Length": String(data.byteLength),
      "Cache-Control": "private, no-store",
    }).send(data);
  } catch (error) {
    sendApiError(res, error);
  }
}

async function listAgentItems(req: Request, res: Response, current: BrokerConfig): Promise<void> {
  try {
    const session = requireApiSession(req, current);
    const conversationId = parseIdentifier(req.params.conversationId, "conversation_id");
    const query = new URLSearchParams({ limit: "100", order: "asc" });
    if (typeof req.query.after === "string" && req.query.after) query.set("after", parseIdentifier(req.query.after, "after"));
    audit("agent.items.read", session, current, requestId(req), { conversationId });
    await proxyJson(
      res,
      session,
      current,
      `/api/2.0/genie/agents/${current.genieAgentId}/conversations/${conversationId}/items?${query}`,
    );
  } catch (error) {
    sendApiError(res, error);
  }
}

async function streamAgentResponse(req: Request, res: Response, current: BrokerConfig): Promise<void> {
  try {
    const session = requireApiSession(req, current);
    const content = parsePrompt(req.body?.content);
    const conversationId = req.body?.conversationId == null
      ? undefined
      : parseIdentifier(req.body.conversationId, "conversation_id");
    audit("agent.response.create", session, current, requestId(req), { ...(conversationId ? { conversationId } : {}) });
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    const upstream = await databricksFetch(
      workspaceUrl(current, `/api/2.0/genie/agents/${current.genieAgentId}/responses`),
      session.accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          input: [{ type: "message", role: "user", content: [{ type: "input_text", text: content }] }],
          enable_viz: true,
          ...(conversationId ? { conversation_id: conversationId } : {}),
        }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(31 * 60_000)]),
      },
    );
    if (!upstream.ok || !upstream.body) {
      await sendUpstreamFailure(res, upstream);
      return;
    }
    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) await new Promise<void>((resolve) => res.once("drain", resolve));
    }
    res.end();
  } catch (error) {
    if (res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: publicErrorCode(error) })}\n\n`);
      res.end();
    } else {
      sendApiError(res, error);
    }
  }
}

async function proxyJson(
  res: Response,
  session: ApiSession,
  current: BrokerConfig,
  path: string,
  init: RequestInit = {},
): Promise<void> {
  const upstream = await databricksFetch(workspaceUrl(current, path), session.accessToken, init);
  if (!upstream.ok) {
    await sendUpstreamFailure(res, upstream);
    return;
  }
  const payload = sanitizeDatabricksJson(await upstream.json());
  res.status(upstream.status).json(payload);
}

async function sendUpstreamFailure(res: Response, upstream: globalThis.Response): Promise<void> {
  const payload = await upstream.json().catch(() => ({})) as Record<string, unknown>;
  const code = typeof payload.error_code === "string"
    ? payload.error_code
    : typeof payload.error === "string"
      ? payload.error
      : "databricks_request_failed";
  const message = typeof payload.message === "string" ? payload.message.slice(0, 1_000) : undefined;
  res.status(upstream.status).json({ error: code, ...(message ? { message } : {}) });
}

function requireApiSession(req: Request, current: BrokerConfig): ApiSession {
  const value = req.header("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!value) throw new ApiError("missing_session", 401);
  try {
    return openApiSession(value, current.stateSecret);
  } catch {
    throw new ApiError("session_expired", 401);
  }
}

function parsePrompt(value: unknown): string {
  if (typeof value !== "string") throw new ApiError("invalid_prompt", 400);
  const prompt = value.trim();
  if (!prompt || prompt.length > 10_000) throw new ApiError("invalid_prompt", 400);
  return prompt;
}

function parseIdentifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[a-z0-9_-]{8,160}$/i.test(value)) throw new ApiError(`invalid_${name}`, 400);
  return encodeURIComponent(value);
}

function parseMessageAttachmentIds(req: Request): {
  conversationId: string;
  messageId: string;
  attachmentId: string;
} {
  return {
    conversationId: parseIdentifier(req.params.conversationId, "conversation_id"),
    messageId: parseIdentifier(req.params.messageId, "message_id"),
    attachmentId: parseIdentifier(req.params.attachmentId, "attachment_id"),
  };
}

function requestId(req: Request): string {
  const supplied = req.header("X-Request-ID");
  return supplied && /^[a-z0-9_-]{8,128}$/i.test(supplied) ? supplied : randomUUID();
}

function audit(
  action: string,
  session: ApiSession,
  current: BrokerConfig,
  correlationId: string,
  resource: Record<string, string>,
): void {
  console.log(JSON.stringify({
    event: "genie.audit",
    timestamp: new Date().toISOString(),
    authorizationMode: "federated_user",
    action,
    correlationId,
    sessionId: session.sessionId,
    veevaUser: session.actorUserName,
    federatedUser: session.externalUserName,
    databricksPrincipal: session.databricksUserName,
    genieAgentId: current.genieAgentId,
    resource,
  }));
}

function sendApiError(res: Response, error: unknown): void {
  if (error instanceof ApiError || error instanceof DatabricksError || error instanceof VeevaError) {
    res.status(error.status).json({ error: error.code });
    return;
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    res.status(504).json({ error: "databricks_timeout" });
    return;
  }
  res.status(500).json({ error: "broker_error" });
}

function publicErrorCode(error: unknown): string {
  return error instanceof ApiError || error instanceof DatabricksError || error instanceof VeevaError
    ? error.code
    : "stream_failed";
}

function publicErrorStatus(error: unknown): number {
  return error instanceof ApiError || error instanceof DatabricksError || error instanceof VeevaError
    ? error.status
    : 500;
}

function isVeevaHttpsOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.origin !== origin.replace(/\/$/, "")) return false;
    const hostname = url.hostname.toLowerCase();
    return hostname === "veevavault.com"
      || hostname.endsWith(".veevavault.com")
      || hostname === "veevacrm.com"
      || hostname.endsWith(".veevacrm.com");
  } catch {
    return false;
  }
}

class ApiError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}
