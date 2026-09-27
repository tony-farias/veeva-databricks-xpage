import type {
  AgentStreamEvent,
  BrokerSession,
  GenieMessage,
  QueryResultResponse,
  StartConversationResponse,
} from "../types/genie";

export class BrokerApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message?: string) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export async function createBrokerSession(
  brokerBaseUrl: string,
  assertion: string,
): Promise<BrokerSession> {
  return request<BrokerSession>(brokerBaseUrl, "/api/session", undefined, {
    method: "POST",
    body: JSON.stringify({ assertion }),
  });
}

export async function startChat(
  brokerBaseUrl: string,
  sessionToken: string,
  content: string,
): Promise<StartConversationResponse> {
  return request(brokerBaseUrl, "/api/genie/chat/start", sessionToken, {
    method: "POST",
    body: JSON.stringify({ content, enableVisualization: true }),
  });
}

export async function continueChat(
  brokerBaseUrl: string,
  sessionToken: string,
  conversationId: string,
  content: string,
): Promise<GenieMessage> {
  return request(
    brokerBaseUrl,
    `/api/genie/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
    sessionToken,
    { method: "POST", body: JSON.stringify({ content, enableVisualization: true }) },
  );
}

export async function getChatMessage(
  brokerBaseUrl: string,
  sessionToken: string,
  conversationId: string,
  messageId: string,
): Promise<GenieMessage> {
  return request(
    brokerBaseUrl,
    `/api/genie/chat/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
    sessionToken,
  );
}

export async function getQueryResult(
  brokerBaseUrl: string,
  sessionToken: string,
  conversationId: string,
  messageId: string,
  attachmentId: string,
): Promise<QueryResultResponse> {
  return request(
    brokerBaseUrl,
    `/api/genie/chat/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/query-result`,
    sessionToken,
  );
}

export async function getVisualization(
  brokerBaseUrl: string,
  sessionToken: string,
  conversationId: string,
  messageId: string,
  attachmentId: string,
): Promise<Blob> {
  const response = await fetch(
    `${brokerBaseUrl}/api/genie/chat/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/visualization`,
    {
      headers: { Authorization: `Bearer ${sessionToken}` },
      cache: "no-store",
      mode: "cors",
    },
  );
  if (!response.ok) throw await responseError(response);
  return response.blob();
}

export async function streamResearch(
  brokerBaseUrl: string,
  sessionToken: string,
  content: string,
  conversationId: string | undefined,
  onEvent: (event: AgentStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${brokerBaseUrl}/api/genie/agent/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ content, ...(conversationId ? { conversationId } : {}) }),
    cache: "no-store",
    mode: "cors",
    signal,
  });
  if (!response.ok || !response.body) throw await responseError(response);

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

async function request<T>(
  brokerBaseUrl: string,
  path: string,
  sessionToken?: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (sessionToken) headers.set("Authorization", `Bearer ${sessionToken}`);
  const response = await fetch(`${brokerBaseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    mode: "cors",
  });
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<T>;
}

async function responseError(response: Response): Promise<BrokerApiError> {
  const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
  return new BrokerApiError(response.status, payload.error || "request_failed", payload.message);
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
