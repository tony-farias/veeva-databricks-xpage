import { createHmac, timingSafeEqual } from "node:crypto";

// Every X-Page user shares one service principal, so Genie lets any of them read
// any conversation, including stored results computed under another user's
// identity claim. A ticket binds a conversation to the claim that started it.
const VERSION = "ct1";

export interface TicketScope {
  genieAgentId: string;
  identityClaim: string;
  secret: string;
}

export function issueConversationTicket(conversationId: string, scope: TicketScope): string {
  return `${VERSION}.${mac(conversationId, scope).toString("base64url")}`;
}

export function hasConversationTicket(
  ticket: string | undefined,
  conversationId: string,
  scope: TicketScope,
): boolean {
  const [version, signature, extra] = (ticket ?? "").split(".");
  if (version !== VERSION || !signature || extra !== undefined) return false;
  const supplied = Buffer.from(signature, "base64url");
  const expected = mac(conversationId, scope);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function mac(conversationId: string, scope: TicketScope): Buffer {
  return createHmac("sha256", scope.secret)
    .update(`${VERSION}\n${scope.genieAgentId}\n${conversationId}\n${scope.identityClaim}`, "utf8")
    .digest();
}

// Agent mode reveals a new conversation ID only inside its event stream. This
// passes the stream through unchanged and, after the first complete event that
// names the conversation, appends a broker event that carries its ticket.
export function conversationTicketInjector(issue: (conversationId: string) => string): {
  push(text: string): string;
  flush(): string;
} {
  let pending = "";
  let issued = false;
  return {
    push(text: string): string {
      if (issued) return text;
      pending += text;
      let output = "";
      let start = 0;
      const delimiter = /\r?\n\r?\n/g;
      for (let match = delimiter.exec(pending); match && !issued; match = delimiter.exec(pending)) {
        const end = match.index + match[0].length;
        const event = pending.slice(start, end);
        output += event;
        start = end;
        const conversationId = conversationIdOf(event);
        if (conversationId) {
          issued = true;
          output += ticketEvent(conversationId, issue(conversationId));
        }
      }
      pending = pending.slice(start);
      if (!issued) return output;
      output += pending;
      pending = "";
      return output;
    },
    flush(): string {
      const rest = pending;
      pending = "";
      return rest;
    },
  };
}

function conversationIdOf(event: string): string | undefined {
  const data = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return undefined;
  try {
    const parsed = JSON.parse(data) as { conversation_id?: unknown; response?: { conversation_id?: unknown } };
    const candidate = parsed.response?.conversation_id ?? parsed.conversation_id;
    return typeof candidate === "string" && /^[a-z0-9_-]{8,160}$/i.test(candidate) ? candidate : undefined;
  } catch {
    // Keepalive and non-JSON frames cannot name a conversation.
    return undefined;
  }
}

function ticketEvent(conversationId: string, ticket: string): string {
  const data = JSON.stringify({
    type: "broker.conversation",
    conversation_id: conversationId,
    conversation_ticket: ticket,
  });
  return `event: broker.conversation\ndata: ${data}\n\n`;
}
