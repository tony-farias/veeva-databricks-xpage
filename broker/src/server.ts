import { createHash, randomBytes } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { openApiSession, sealApiSession, type ApiSession } from "./apiSession.js";
import { loadConfig, type BrokerConfig } from "./config.js";
import {
  DatabricksError,
  databricksFetch,
  exchangeFederatedAssertion,
  sanitizeDatabricksJson,
  workspaceUrl,
} from "./databricks.js";
import { completionPage, redirectFailurePage } from "./html.js";
import {
  openState,
  sealState,
  type AuthCarrier,
  type AuthState,
  type MessageAuthState,
} from "./state.js";

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

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/", (_req, res) => res.type("text/plain").send("Vault CRM headless Genie broker"));

const sessionLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });
const genieLimiter = rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: "draft-8", legacyHeaders: false });

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

app.get(
  "/auth/start",
  rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false }),
  (req, res) => startAuthentication(req, res, config),
);
app.get("/auth/callback", (req, res) => completeAuthentication(req, res, config));

app.listen(config.port, () => {
  console.log(`Vault CRM headless Genie broker listening on port ${config.port}`);
});

function applyCors(req: Request, res: Response, next: NextFunction, current: BrokerConfig): void {
  const origin = req.header("Origin");
  if (!origin) {
    next();
    return;
  }
  const allowed = origin === "null"
    ? current.allowOpaqueParentOrigin
    : current.allowedParentOrigins.has(origin);
  if (!allowed) {
    res.status(403).json({ error: "origin_not_allowed" });
    return;
  }
  res.set({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
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
    if (!assertion) throw new ApiError("missing_external_token", 400);
    const identity = await exchangeFederatedAssertion(assertion, current);
    const sessionToken = sealApiSession(identity, current.stateSecret);
    res.json({
      sessionToken,
      expiresAt: new Date(identity.expiresAt).toISOString(),
      user: { userName: identity.userName, displayName: identity.displayName },
    });
  } catch (error) {
    sendApiError(res, error);
  }
}

function getApiIdentity(req: Request, res: Response, current: BrokerConfig): void {
  try {
    const session = requireApiSession(req, current);
    res.json({
      user: { userName: session.userName, displayName: session.displayName },
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
    await proxyJson(res, session, current, `/api/2.0/genie/spaces/${current.genieSpaceId}/start-conversation`, {
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
    await proxyJson(
      res,
      session,
      current,
      `/api/2.0/genie/spaces/${current.genieSpaceId}/conversations/${conversationId}/messages`,
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
    await proxyJson(
      res,
      session,
      current,
      `/api/2.0/genie/spaces/${current.genieSpaceId}/conversations/${conversationId}/messages/${messageId}`,
    );
  } catch (error) {
    sendApiError(res, error);
  }
}

async function getQueryResult(req: Request, res: Response, current: BrokerConfig): Promise<void> {
  try {
    const session = requireApiSession(req, current);
    const { conversationId, messageId, attachmentId } = parseMessageAttachmentIds(req);
    await proxyJson(
      res,
      session,
      current,
      `/api/2.0/genie/spaces/${current.genieSpaceId}/conversations/${conversationId}/messages/${messageId}/attachments/${attachmentId}/query-result`,
    );
  } catch (error) {
    sendApiError(res, error);
  }
}

async function getVisualization(req: Request, res: Response, current: BrokerConfig): Promise<void> {
  try {
    const session = requireApiSession(req, current);
    const { conversationId, messageId, attachmentId } = parseMessageAttachmentIds(req);
    const name = `spaces/${current.genieSpaceId}/conversations/${conversationId}/messages/${messageId}/attachments/${attachmentId}`;
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
    await proxyJson(
      res,
      session,
      current,
      `/api/2.0/genie/agents/${current.genieSpaceId}/conversations/${conversationId}/items?${query}`,
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
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    const upstream = await databricksFetch(
      workspaceUrl(current, `/api/2.0/genie/agents/${current.genieSpaceId}/responses`),
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

function sendApiError(res: Response, error: unknown): void {
  if (error instanceof ApiError || error instanceof DatabricksError) {
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
  return error instanceof ApiError || error instanceof DatabricksError ? error.code : "stream_failed";
}

class ApiError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

function startAuthentication(req: Request, res: Response, current: BrokerConfig): void {
  try {
    const carrier = parseCarrier(req.query.carrier);
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const expiresAt = Date.now() + 10 * 60_000;
    const state: AuthState = carrier === "redirect"
      ? { verifier, carrier, expiresAt }
      : {
          verifier,
          carrier,
          parentOrigin: parseParentOrigin(req.query.parent_origin, current),
          channelId: parseChannelId(req.query.channel_id),
          expiresAt,
        };
    const sealedState = sealState(state, current.stateSecret);
    const authorize = new URLSearchParams({
      client_id: current.clientId,
      redirect_uri: current.redirectUri,
      response_type: "code",
      scope: current.oauthScopes,
      state: sealedState,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const authorizePath = `/oidc/v1/authorize?${authorize.toString()}`;
    const nextUrl = Buffer.from(authorizePath, "utf8").toString("base64");
    res.redirect(302, `${workspaceBase(current)}/aad/auth?next_url=${encodeURIComponent(nextUrl)}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid_request";
    res.status(400).json({ error: detail });
  }
}

async function completeAuthentication(req: Request, res: Response, current: BrokerConfig): Promise<void> {
  const stateValue = singleQuery(req.query.state);
  if (!stateValue) {
    res.status(400).type("text/plain").send("Missing OAuth state");
    return;
  }

  let state: AuthState;
  try {
    state = openState(stateValue, current.stateSecret);
    if (state.carrier !== "redirect") {
      // Recheck the origin against current policy rather than trusting only the
      // encrypted value. This makes origin removal take effect immediately.
      assertParentOriginAllowed(state.parentOrigin, current);
    }
  } catch {
    res.status(400).type("text/plain").send("Invalid or expired OAuth state");
    return;
  }

  if (singleQuery(req.query.error)) {
    sendFailure(res, state, "oauth_denied");
    return;
  }

  const code = singleQuery(req.query.code);
  if (!code) {
    sendFailure(res, state, "missing_authorization_code");
    return;
  }

  try {
    const token = await exchangeCode(code, state.verifier, current);
    if (state.carrier === "redirect") {
      res.redirect(303, current.genieRedirectUrl);
      return;
    }
    const email = await resolveIdentity(token, current);
    sendCompletion(res, state, true, email, "");
  } catch (error) {
    const detail = error instanceof BrokerError ? error.code : "authentication_failed";
    sendFailure(res, state, detail);
  }
}

async function exchangeCode(code: string, verifier: string, current: BrokerConfig): Promise<string> {
  const body = new URLSearchParams({
    client_id: current.clientId,
    client_secret: current.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: current.redirectUri,
    code_verifier: verifier,
  });
  const response = await fetch(`${workspaceBase(current)}/oidc/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new BrokerError("token_exchange_failed");
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw new BrokerError("token_exchange_failed");
  return payload.access_token;
}

async function resolveIdentity(token: string, current: BrokerConfig): Promise<string | null> {
  try {
    const response = await fetch(`${workspaceBase(current)}/api/2.0/preview/scim/v2/Me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { userName?: string };
    return payload.userName ?? null;
  } catch {
    // Identity display is optional. A successful token exchange is enough to
    // establish that the Databricks U2M flow completed.
    return null;
  }
}

function sendCompletion(
  res: Response,
  state: MessageAuthState,
  ok: boolean,
  email: string | null,
  detail: string,
): void {
  const page = completionPage(state.carrier, state.parentOrigin, {
    type: "genie-sso:mint-complete",
    ok,
    email,
    detail,
    channelId: state.channelId,
  });
  res.status(200).set({
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": page.contentSecurityPolicy,
  }).send(page.html);
}

function sendFailure(res: Response, state: AuthState, detail: string): void {
  if (state.carrier !== "redirect") {
    sendCompletion(res, state, false, null, detail);
    return;
  }

  const page = redirectFailurePage();
  res.status(400).set({
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": page.contentSecurityPolicy,
  }).send(page.html);
}

function parseCarrier(value: unknown): AuthCarrier {
  const carrier = singleQuery(value);
  if (carrier !== "iframe" && carrier !== "popup" && carrier !== "redirect") throw new Error("invalid_carrier");
  return carrier;
}

function parseChannelId(value: unknown): string {
  const channelId = singleQuery(value);
  if (!channelId || !/^[a-z0-9-]{16,64}$/i.test(channelId)) throw new Error("invalid_channel_id");
  return channelId;
}

function parseParentOrigin(value: unknown, current: BrokerConfig): string {
  const origin = singleQuery(value);
  if (!origin) throw new Error("missing_parent_origin");
  assertParentOriginAllowed(origin, current);
  return origin;
}

function assertParentOriginAllowed(origin: string, current: BrokerConfig): void {
  if (origin === "opaque") {
    if (!current.allowOpaqueParentOrigin) throw new Error("opaque_parent_origin_not_allowed");
    return;
  }
  let normalized: string;
  try {
    normalized = new URL(origin).origin;
  } catch {
    throw new Error("invalid_parent_origin");
  }
  if (normalized !== origin || !current.allowedParentOrigins.has(normalized)) {
    throw new Error("parent_origin_not_allowed");
  }
}

function singleQuery(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function workspaceBase(current: BrokerConfig): string {
  return `https://${current.workspaceHost}`;
}

class BrokerError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
