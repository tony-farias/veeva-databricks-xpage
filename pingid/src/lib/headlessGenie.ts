import type {
  AgentStreamEvent,
  BrokerSession,
  ConversationHandle,
  GenieMessage,
  QueryResultResponse,
  StartConversationResponse,
} from "../types/genie";
import { getAccessToken, type SsoProvider } from "./pingToken";

export class BrokerApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message?: string) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

// Every broker call goes through Kong and carries the caller's Ping bearer
// token; there is no broker-issued session token. Inside MyInsights the call
// runs through the Veeva request bridge (ds.request), exactly like the
// customer's existing dashboards call Kong. Elsewhere it falls back to fetch.
export interface BrokerClient {
  baseUrl: string;
  provider: SsoProvider;
}

interface BrokerResponse {
  status: number;
  body: string;
}

interface SendOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutSeconds?: number;
}

const DEFAULT_TIMEOUT_SECONDS = 30;
// The bridge cannot stream, so Agent mode waits for the full response.
const AGENT_TIMEOUT_SECONDS = 300;

export async function connectBroker(client: BrokerClient): Promise<BrokerSession> {
  return requestJson<BrokerSession>(client, "/api/session", { method: "POST" });
}

export async function startChat(client: BrokerClient, content: string): Promise<StartConversationResponse> {
  return requestJson(client, "/api/genie/chat/start", {
    method: "POST",
    body: JSON.stringify({ content, enableVisualization: true }),
  });
}

export async function continueChat(
  client: BrokerClient,
  conversation: ConversationHandle,
  content: string,
): Promise<GenieMessage> {
  return requestJson(client, `${conversationPath(conversation)}/messages`, {
    method: "POST",
    headers: ticketHeader(conversation),
    body: JSON.stringify({ content, enableVisualization: true }),
  });
}

export async function getChatMessage(
  client: BrokerClient,
  conversation: ConversationHandle,
  messageId: string,
): Promise<GenieMessage> {
  return requestJson(client, `${conversationPath(conversation)}/messages/${encodeURIComponent(messageId)}`, {
    headers: ticketHeader(conversation),
  });
}

export async function getQueryResult(
  client: BrokerClient,
  conversation: ConversationHandle,
  messageId: string,
  attachmentId: string,
): Promise<QueryResultResponse> {
  return requestJson(client, `${attachmentPath(conversation, messageId, attachmentId)}/query-result`, {
    headers: ticketHeader(conversation),
  });
}

export async function getVisualization(
  client: BrokerClient,
  conversation: ConversationHandle,
  messageId: string,
  attachmentId: string,
): Promise<Blob> {
  // The bridge returns bodies as text, so the broker sends the image as base64.
  const payload = await requestJson<{ contentType?: string; data?: string }>(
    client,
    `${attachmentPath(conversation, messageId, attachmentId)}/visualization?encoding=base64`,
    { headers: ticketHeader(conversation) },
  );
  if (!payload.data) throw new Error("invalid_visualization_payload");
  const binary = atob(payload.data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: payload.contentType || "image/png" });
}

export async function streamResearch(
  client: BrokerClient,
  content: string,
  conversation: ConversationHandle | undefined,
  onEvent: (event: AgentStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const options: SendOptions = {
    method: "POST",
    headers: { Accept: "text/event-stream", ...(conversation ? ticketHeader(conversation) : {}) },
    body: JSON.stringify({ content, ...(conversation ? { conversationId: conversation.id } : {}) }),
    timeoutSeconds: AGENT_TIMEOUT_SECONDS,
  };
  if (window.ds?.request) {
    // No progressive updates over the bridge: wait for the whole event stream,
    // then replay its events in order (including the broker.conversation
    // ticket event).
    const response = await send(client, "/api/genie/agent/responses", options);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (response.status < 200 || response.status >= 300) throw responseError(response);
    for (const block of response.body.split(/\r?\n\r?\n/)) emitSseBlock(block, onEvent);
    return;
  }

  const response = await fetchStream(client, "/api/genie/agent/responses", options, signal);
  if (!response.body) throw new BrokerApiError(response.status, "request_failed");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? "";
    for (const block of parts) emitSseBlock(block, onEvent);
    if (done) break;
  }
  if (buffer.trim()) emitSseBlock(buffer, onEvent);
}

async function requestJson<T>(client: BrokerClient, path: string, options: SendOptions = {}): Promise<T> {
  const response = await send(client, path, {
    ...options,
    headers: { Accept: "application/json", ...options.headers },
  });
  if (response.status < 200 || response.status >= 300) throw responseError(response);
  try {
    return JSON.parse(response.body) as T;
  } catch {
    throw new BrokerApiError(response.status, "invalid_broker_response");
  }
}

// Sends one call with a fresh Ping token. If Kong (or the broker) answers 401,
// force a token refresh once and retry.
async function send(client: BrokerClient, path: string, options: SendOptions): Promise<BrokerResponse> {
  const first = await sendOnce(client, path, options, await getAccessToken(client.provider));
  if (first.status !== 401) return first;
  return sendOnce(client, path, options, await getAccessToken(client.provider, true));
}

async function sendOnce(
  client: BrokerClient,
  path: string,
  options: SendOptions,
  pingToken: string,
): Promise<BrokerResponse> {
  const headers: Record<string, string> = {
    ...options.headers,
    Authorization: `Bearer ${pingToken}`,
    ...(options.body ? { "Content-Type": "application/json" } : {}),
  };
  const url = `${client.baseUrl}${path}`;
  const ds = window.ds;
  if (ds?.request) {
    const request: VeevaRequestObject = {
      url,
      method: options.method ?? "GET",
      headers,
      ...(options.body ? { body: options.body } : {}),
      expect: "text",
      timeout: options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
    };
    // The bridge rejects on transport failures; some hosts also reject with an
    // HTTP status attached, so normalize both paths.
    const result = await ds.request(request).then((value) => value, (error: unknown) => error);
    return bridgeResponse(result);
  }

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body,
    cache: "no-store",
    mode: "cors",
  });
  return { status: response.status, body: await response.text() };
}

async function fetchStream(
  client: BrokerClient,
  path: string,
  options: SendOptions,
  signal?: AbortSignal,
): Promise<Response> {
  const attempt = async (pingToken: string) => fetch(`${client.baseUrl}${path}`, {
    method: options.method ?? "POST",
    headers: {
      ...options.headers,
      Authorization: `Bearer ${pingToken}`,
      "Content-Type": "application/json",
    },
    body: options.body,
    cache: "no-store",
    mode: "cors",
    signal,
  });
  let response = await attempt(await getAccessToken(client.provider));
  if (response.status === 401) response = await attempt(await getAccessToken(client.provider, true));
  if (!response.ok) throw responseError({ status: response.status, body: await response.text() });
  return response;
}

function bridgeResponse(result: unknown): BrokerResponse {
  const value = (result ?? {}) as VeevaRequestResponse;
  const status = value.data?.statusCode;
  if (typeof status !== "number") {
    throw new BrokerApiError(0, "gateway_unreachable", value.message);
  }
  return { status, body: typeof value.data?.body === "string" ? value.data.body : "" };
}

function conversationPath(conversation: ConversationHandle): string {
  return `/api/genie/chat/conversations/${encodeURIComponent(conversation.id)}`;
}

function attachmentPath(conversation: ConversationHandle, messageId: string, attachmentId: string): string {
  return `${conversationPath(conversation)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

function ticketHeader(conversation: ConversationHandle): Record<string, string> {
  return { "X-Conversation-Ticket": conversation.ticket };
}

function responseError(response: BrokerResponse): BrokerApiError {
  let payload: { error?: string; message?: string } = {};
  try {
    payload = JSON.parse(response.body) as typeof payload;
  } catch {
    // Kong and other gateways may answer with non-JSON bodies.
  }
  const code = payload.error || (response.status === 401 ? "gateway_unauthorized" : "request_failed");
  return new BrokerApiError(response.status, code, payload.message);
}

function emitSseBlock(block: string, onEvent: (event: AgentStreamEvent) => void): void {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data || data === "[DONE]") return;
  try {
    onEvent(JSON.parse(data) as AgentStreamEvent);
  } catch {
    // Ignore keepalive or non-JSON SSE frames. Terminal events are JSON.
  }
}
