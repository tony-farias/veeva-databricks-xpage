import { randomUUID } from "node:crypto";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import type { BrokerConfig } from "./config.js";
import {
  conversationTicketInjector,
  hasConversationTicket,
  issueConversationTicket,
  type TicketScope,
} from "./conversationTicket.js";
import {
  DatabricksError,
  databricksFetch,
  getServicePrincipalIdentity,
  sanitizeDatabricksJson,
  workspaceUrl,
} from "./databricks.js";
import { IdentityError, extractIdentity } from "./pingIdentity.js";

// Everything the broker knows about a caller is derived from the Ping bearer
// token that Kong validated and forwarded on this request. The broker issues no
// session token of its own, so every call must carry the Ping token.
interface CallerContext {
  accessToken: string;
  identityClaim: string;
  actorDisplayName: string | null;
  executionApplicationId: string;
  executionDisplayName: string;
}

// Builds the broker's Express app without binding a port, so the same app runs
// as a standalone server (server.ts) or inside an Azure Functions HTTP trigger
// (functions/broker.ts).
export function createBrokerApp(config: BrokerConfig): Express {
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

  app.get("/health", (_req, res) => res.json({ ok: true, authorizationMode: "service_principal", dataScope: "identity_claim" }));
  app.get("/", (_req, res) => res.type("text/plain").send("Vault CRM Genie service-principal broker"));

  // Every rep reaches the broker through the same Kong gateway, so limits are
  // counted per identity claim rather than per client IP.
  const limiterKey = (req: Request) => rateLimitKey(req, config);
  const sessionLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false, keyGenerator: limiterKey });
  const genieLimiter = rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: "draft-8", legacyHeaders: false, keyGenerator: limiterKey });

  app.post("/api/session", sessionLimiter, (req, res) => connectCaller(req, res, config));
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

  return app;
}

export function rateLimitKey(req: Request, current: BrokerConfig): string {
  try {
    return `claim:${extractIdentity(req.header("Authorization"), current).identityClaim}`;
  } catch {
    return `ip:${ipKeyGenerator(req.ip ?? "")}`;
  }
}

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
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Conversation-Ticket, X-Request-ID",
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

async function connectCaller(req: Request, res: Response, current: BrokerConfig): Promise<void> {
  try {
    const caller = await requireCaller(req, current);
    audit("session.connected", caller, current, requestId(req), {});
    res.json(callerSummary(caller, current));
  } catch (error) {
    sendApiError(res, error);
  }
}

async function getApiIdentity(req: Request, res: Response, current: BrokerConfig): Promise<void> {
  try {
    res.json(callerSummary(await requireCaller(req, current), current));
  } catch (error) {
    sendApiError(res, error);
  }
}

function callerSummary(caller: CallerContext, current: BrokerConfig): Record<string, unknown> {
  return {
    authorizationMode: "service_principal",
    user: { userName: caller.identityClaim, displayName: caller.actorDisplayName },
    executionIdentity: {
      applicationId: caller.executionApplicationId,
      displayName: caller.executionDisplayName,
    },
    dataScope: dataScope(caller, current),
  };
}

async function startChat(req: Request, res: Response, current: BrokerConfig): Promise<void> {
  try {
    const caller = await requireCaller(req, current);
    const content = parsePrompt(req.body?.content);
    audit("chat.start", caller, current, requestId(req), {});
    await proxyJson(
      res,
      caller,
      current,
      `/api/2.0/genie/spaces/${current.genieAgentId}/start-conversation`,
      {
        method: "POST",
        body: JSON.stringify({ content, enable_visualization: req.body?.enableVisualization !== false }),
      },
      (payload) => {
        const conversationId = startedConversationId(payload);
        if (!conversationId) throw new ApiError("genie_missing_conversation", 502);
        return { ...payload, conversation_ticket: issueConversationTicket(conversationId, ticketScope(caller, current)) };
      },
    );
  } catch (error) {
    sendApiError(res, error);
  }
}

async function continueChat(req: Request, res: Response, current: BrokerConfig): Promise<void> {
  try {
    const caller = await requireCaller(req, current);
    const conversationId = requireConversation(req, req.params.conversationId, caller, current);
    const content = parsePrompt(req.body?.content);
    audit("chat.continue", caller, current, requestId(req), { conversationId });
    await proxyJson(
      res,
      caller,
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
    const caller = await requireCaller(req, current);
    const conversationId = requireConversation(req, req.params.conversationId, caller, current);
    const messageId = parseIdentifier(req.params.messageId, "message_id");
    const correlationId = requestId(req);
    audit("chat.message.read", caller, current, correlationId, { conversationId, messageId });
    await proxyJson(
      res,
      caller,
      current,
      `/api/2.0/genie/spaces/${current.genieAgentId}/conversations/${conversationId}/messages/${messageId}`,
      {},
      (payload) => {
        // Query history names only the service principal. Logging the statement
        // IDs once per finished message lets audits join them to the Veeva user.
        const statementIds = completedStatementIds(payload);
        if (statementIds.length) {
          audit("chat.statements", caller, current, correlationId, {
            conversationId,
            messageId,
            statementIds: statementIds.join(","),
          });
        }
        return payload;
      },
    );
  } catch (error) {
    sendApiError(res, error);
  }
}

async function getQueryResult(req: Request, res: Response, current: BrokerConfig): Promise<void> {
  try {
    const caller = await requireCaller(req, current);
    const ids = parseMessageAttachmentIds(req, caller, current);
    audit("chat.query_result.read", caller, current, requestId(req), ids);
    await proxyJson(
      res,
      caller,
      current,
      `/api/2.0/genie/spaces/${current.genieAgentId}/conversations/${ids.conversationId}/messages/${ids.messageId}/attachments/${ids.attachmentId}/query-result`,
    );
  } catch (error) {
    sendApiError(res, error);
  }
}

async function getVisualization(req: Request, res: Response, current: BrokerConfig): Promise<void> {
  try {
    const caller = await requireCaller(req, current);
    const ids = parseMessageAttachmentIds(req, caller, current);
    audit("chat.visualization.read", caller, current, requestId(req), ids);
    const name = `spaces/${current.genieAgentId}/conversations/${ids.conversationId}/messages/${ids.messageId}/attachments/${ids.attachmentId}`;
    const upstream = await databricksFetch(
      workspaceUrl(current, `/api/2.0/genie/${name}/download-visualization`),
      caller.accessToken,
    );
    if (!upstream.ok) {
      await sendUpstreamFailure(res, upstream);
      return;
    }
    const data = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get("content-type") || "image/png";
    // The MyInsights request bridge returns response bodies as text, so it asks
    // for the image as base64 JSON instead of raw bytes.
    if (req.query.encoding === "base64") {
      res.status(200).json({ contentType, data: data.toString("base64") });
      return;
    }
    res.status(200).set({
      "Content-Type": contentType,
      "Content-Length": String(data.byteLength),
      "Cache-Control": "private, no-store",
    }).send(data);
  } catch (error) {
    sendApiError(res, error);
  }
}

async function listAgentItems(req: Request, res: Response, current: BrokerConfig): Promise<void> {
  try {
    const caller = await requireCaller(req, current);
    const conversationId = requireConversation(req, req.params.conversationId, caller, current);
    const query = new URLSearchParams({ limit: "100", order: "asc" });
    if (typeof req.query.after === "string" && req.query.after) query.set("after", parseIdentifier(req.query.after, "after"));
    audit("agent.items.read", caller, current, requestId(req), { conversationId });
    await proxyJson(
      res,
      caller,
      current,
      `/api/2.0/genie/agents/${current.genieAgentId}/conversations/${conversationId}/items?${query}`,
    );
  } catch (error) {
    sendApiError(res, error);
  }
}

async function streamAgentResponse(req: Request, res: Response, current: BrokerConfig): Promise<void> {
  try {
    const caller = await requireCaller(req, current);
    const content = parsePrompt(req.body?.content);
    const conversationId = req.body?.conversationId == null
      ? undefined
      : requireConversation(req, req.body.conversationId, caller, current);
    audit("agent.response.create", caller, current, requestId(req), { ...(conversationId ? { conversationId } : {}) });
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    const upstream = await databricksFetch(
      workspaceUrl(current, `/api/2.0/genie/agents/${current.genieAgentId}/responses`),
      caller.accessToken,
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
    const write = async (chunk: string | Buffer) => {
      if (chunk.length && !res.write(chunk)) await new Promise<void>((resolve) => res.once("drain", resolve));
    };
    if (conversationId) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await write(Buffer.from(value));
      }
    } else {
      const decoder = new TextDecoder();
      const injector = conversationTicketInjector((id) => issueConversationTicket(id, ticketScope(caller, current)));
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await write(injector.push(decoder.decode(value, { stream: true })));
      }
      await write(injector.push(decoder.decode()) + injector.flush());
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
  caller: CallerContext,
  current: BrokerConfig,
  path: string,
  init: RequestInit = {},
  transform?: (payload: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const upstream = await databricksFetch(workspaceUrl(current, path), caller.accessToken, init);
  if (!upstream.ok) {
    await sendUpstreamFailure(res, upstream);
    return;
  }
  const payload = sanitizeDatabricksJson(await upstream.json());
  const isObject = payload !== null && typeof payload === "object" && !Array.isArray(payload);
  res.status(upstream.status).json(transform && isObject ? transform(payload as Record<string, unknown>) : payload);
}

async function sendUpstreamFailure(res: Response, upstream: globalThis.Response): Promise<void> {
  const payload = await upstream.json().catch(() => ({})) as Record<string, unknown>;
  const code = typeof payload.error_code === "string"
    ? payload.error_code
    : typeof payload.error === "string"
      ? payload.error
      : "databricks_request_failed";
  const message = typeof payload.message === "string" ? payload.message.slice(0, 1_000) : undefined;
  if (message?.includes("OAUTH_CUSTOM_IDENTITY_CLAIM_NOT_PROVIDED")) {
    res.status(upstream.status).json({ error: "data_scope_unavailable" });
    return;
  }
  res.status(upstream.status).json({ error: code, ...(message ? { message } : {}) });
}

async function requireCaller(req: Request, current: BrokerConfig): Promise<CallerContext> {
  try {
    const actor = extractIdentity(req.header("Authorization"), current);
    const execution = await getServicePrincipalIdentity(current, actor.identityClaim);
    return {
      accessToken: execution.accessToken,
      identityClaim: actor.identityClaim,
      actorDisplayName: actor.displayName,
      executionApplicationId: execution.applicationId,
      executionDisplayName: execution.displayName,
    };
  } catch (error) {
    console.warn(JSON.stringify({
      event: "security.caller_rejected",
      timestamp: new Date().toISOString(),
      correlationId: requestId(req),
      origin: req.header("Origin") ?? null,
      path: req.path,
      error: publicErrorCode(error),
      status: publicErrorStatus(error),
    }));
    throw error;
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

function parseMessageAttachmentIds(req: Request, caller: CallerContext, current: BrokerConfig): {
  conversationId: string;
  messageId: string;
  attachmentId: string;
} {
  return {
    conversationId: requireConversation(req, req.params.conversationId, caller, current),
    messageId: parseIdentifier(req.params.messageId, "message_id"),
    attachmentId: parseIdentifier(req.params.attachmentId, "attachment_id"),
  };
}

function requireConversation(
  req: Request,
  value: unknown,
  caller: CallerContext,
  current: BrokerConfig,
): string {
  const conversationId = parseIdentifier(value, "conversation_id");
  if (!hasConversationTicket(req.header("X-Conversation-Ticket"), conversationId, ticketScope(caller, current))) {
    console.warn(JSON.stringify({
      event: "security.conversation_rejected",
      timestamp: new Date().toISOString(),
      endUser: caller.identityClaim,
      conversationId,
    }));
    throw new ApiError("conversation_not_owned", 403);
  }
  return conversationId;
}

function ticketScope(caller: CallerContext, current: BrokerConfig): TicketScope {
  return { genieAgentId: current.genieAgentId, identityClaim: caller.identityClaim, secret: current.stateSecret };
}

function dataScope(caller: CallerContext, current: BrokerConfig): { mode: "identity_claim"; claimName: string; identityClaim: string } {
  return { mode: "identity_claim", claimName: current.identityClaimName, identityClaim: caller.identityClaim };
}

function startedConversationId(payload: Record<string, unknown>): string | undefined {
  const conversation = payload.conversation as Record<string, unknown> | undefined;
  const message = payload.message as Record<string, unknown> | undefined;
  const candidate = payload.conversation_id ?? conversation?.conversation_id ?? conversation?.id ?? message?.conversation_id;
  return typeof candidate === "string" && /^[a-z0-9_-]{8,160}$/i.test(candidate) ? candidate : undefined;
}

function completedStatementIds(payload: Record<string, unknown>): string[] {
  if (payload.status !== "COMPLETED" && payload.status !== "FAILED") return [];
  if (!Array.isArray(payload.attachments)) return [];
  return payload.attachments.flatMap((attachment) => {
    const query = (attachment as Record<string, unknown> | null)?.query as Record<string, unknown> | undefined;
    return typeof query?.statement_id === "string" ? [query.statement_id] : [];
  });
}

function requestId(req: Request): string {
  const supplied = req.header("X-Request-ID");
  return supplied && /^[a-z0-9_-]{8,128}$/i.test(supplied) ? supplied : randomUUID();
}

function audit(
  action: string,
  caller: CallerContext,
  current: BrokerConfig,
  correlationId: string,
  resource: Record<string, string>,
): void {
  console.log(JSON.stringify({
    event: "genie.audit",
    timestamp: new Date().toISOString(),
    action,
    correlationId,
    endUser: caller.identityClaim,
    databricksPrincipal: caller.executionApplicationId,
    genieAgentId: current.genieAgentId,
    resource,
  }));
}

function sendApiError(res: Response, error: unknown): void {
  if (isPublicError(error)) {
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
  return isPublicError(error) ? error.code : "stream_failed";
}

function publicErrorStatus(error: unknown): number {
  return isPublicError(error) ? error.status : 500;
}

function isPublicError(error: unknown): error is ApiError | DatabricksError | IdentityError {
  return error instanceof ApiError || error instanceof DatabricksError || error instanceof IdentityError;
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
