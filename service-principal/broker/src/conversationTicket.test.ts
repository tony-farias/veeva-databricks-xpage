import assert from "node:assert/strict";
import test from "node:test";
import {
  conversationTicketInjector,
  hasConversationTicket,
  issueConversationTicket,
  type TicketScope,
} from "./conversationTicket.js";

const scope: TicketScope = {
  genieAgentId: "01f1b7b1764a1a04adc67a648599a233",
  identityClaim: "alice@example.com",
  secret: "this-is-a-test-secret-with-more-than-thirty-two-bytes",
};
const conversationId = "01f1bd398ef31daea977dacf39135dad";

test("accepts a ticket for the conversation and claim it was issued to", () => {
  const ticket = issueConversationTicket(conversationId, scope);
  assert.equal(hasConversationTicket(ticket, conversationId, scope), true);
});

test("rejects a ticket presented under another identity claim", () => {
  const ticket = issueConversationTicket(conversationId, scope);
  assert.equal(hasConversationTicket(ticket, conversationId, { ...scope, identityClaim: "bob@example.com" }), false);
});

test("rejects a ticket for another conversation or Genie Agent", () => {
  const ticket = issueConversationTicket(conversationId, scope);
  assert.equal(hasConversationTicket(ticket, "01f1bd3929ad1be98b0969bcf6a8d0de", scope), false);
  assert.equal(hasConversationTicket(ticket, conversationId, { ...scope, genieAgentId: "01f1bd3908071673887fd1a3ba14d351" }), false);
});

test("rejects missing, malformed, and tampered tickets", () => {
  const ticket = issueConversationTicket(conversationId, scope);
  for (const value of [undefined, "", "ct1", `${ticket}.extra`, `ct0.${ticket.slice(4)}`, `${ticket.slice(0, -2)}AA`]) {
    assert.equal(hasConversationTicket(value, conversationId, scope), false, String(value));
  }
});

const created = `event:response.created\ndata:{"response":{"id":"r1","status":"in_progress","conversation_id":"${conversationId}"},"type":"response.created"}\n\n`;
const added = 'event:response.output_item.added\ndata:{"type":"response.output_item.added","item":{"type":"reasoning"}}\n\n';

function issued(id: string): string {
  return `ticket-for-${id}`;
}

test("appends a ticket event after the first event that names the conversation", () => {
  const injector = conversationTicketInjector(issued);
  const output = injector.push(created + added) + injector.flush();
  const ticketEvent = `event: broker.conversation\ndata: ${JSON.stringify({
    type: "broker.conversation",
    conversation_id: conversationId,
    conversation_ticket: `ticket-for-${conversationId}`,
  })}\n\n`;
  assert.equal(output, created + ticketEvent + added);
});

test("never splits an upstream event when chunks break mid-event", () => {
  const injector = conversationTicketInjector(issued);
  const stream = created + added;
  let output = "";
  for (let index = 0; index < stream.length; index += 7) output += injector.push(stream.slice(index, index + 7));
  output += injector.flush();
  const ticketAt = output.indexOf("event: broker.conversation");
  assert.equal(output.slice(0, ticketAt), created);
  assert.equal(output.replace(/event: broker\.conversation\n.*\n\n/, ""), stream);
});

test("issues exactly one ticket and passes later events through unchanged", () => {
  const injector = conversationTicketInjector(issued);
  const output = injector.push(created) + injector.push(created.replace("r1", "r2")) + injector.flush();
  assert.equal(output.match(/event: broker\.conversation/g)?.length, 1);
  assert.equal(output.endsWith(created.replace("r1", "r2")), true);
});

test("handles CRLF event delimiters", () => {
  const injector = conversationTicketInjector(issued);
  const crlf = created.replaceAll("\n", "\r\n");
  const output = injector.push(crlf) + injector.flush();
  assert.equal(output.startsWith(crlf), true);
  assert.match(output, /broker\.conversation/);
});

test("passes a stream without a conversation ID through unchanged", () => {
  const injector = conversationTicketInjector(issued);
  const partial = "event:ping\ndata:keepalive";
  assert.equal(injector.push(added + partial) + injector.flush(), added + partial);
});
