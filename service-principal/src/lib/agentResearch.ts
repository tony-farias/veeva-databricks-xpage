// Turns a Genie Agent mode (Research) response into what the X-Page shows:
// the written answer, the charts Genie generated, the queries that back the
// answer ("sources"), and the remaining intermediate queries ("research steps").
//
// Genie records each tool call as a function_call item and its result as a
// function_call_output item with the same call_id:
// - execute_sql: arguments { title, sql }; output is a markdown table. The
//   call_id doubles as the query attachment ID for the query-result endpoint.
// - generate_visualization: arguments { title, query_attachment_id }; the output
//   metadata.viz.attachment_id is the chart for the download-visualization endpoint.
// The answer cites queries with links into the Databricks UI, which reps cannot
// open, so citations are rewritten to point at the matching source in the X-Page.
// A chart's own query is shown as that chart's data, as in Chat mode.
import type { AgentOutputItem, AgentResponse } from "../types/genie";

export interface ResearchChart {
  attachmentId: string;
  messageId: string;
  title: string;
  queryCallId?: string;
  /** The query behind the chart; set by parseAgentResponse once its output is known. */
  query?: ResearchQuery;
}

export interface ResearchQuery {
  callId: string;
  messageId?: string;
  title: string;
  sql?: string;
  /** Markdown table Genie returned to the agent for this query. */
  output?: string;
}

export interface ResearchSource extends ResearchQuery {
  number: number;
}

export interface ResearchReport {
  /** Markdown answer; citations are rewritten to `[n](#source-n)`. */
  answer: string;
  charts: ResearchChart[];
  /** Queries the answer cites, numbered in citation order. */
  sources: ResearchSource[];
  /** Queries that are neither cited nor behind a chart. */
  steps: ResearchQuery[];
}

export type CallIndex = Map<string, { name?: string; args: Record<string, unknown> }>;

const CITATION_HREF = "#source-";
// Matches `[1](https://<workspace>/genie/rooms/...&gra_focus=<call_id>)`, with or
// without the escaped brackets Genie wraps it in: `\[[1](...)\]`.
const CITATION_PATTERN = /(?:\\\[)?\[(\d+)\]\((https?:\/\/[^)\s]*?[?&]gra_focus=([A-Za-z0-9_-]+)[^)\s]*)\)(?:\\\])?/g;

export function parseAgentResponse(response: AgentResponse): ResearchReport {
  const items = response.output ?? [];
  const calls: CallIndex = new Map();
  for (const item of items) recordCall(item, calls);

  const queries = new Map<string, ResearchQuery>();
  for (const item of items) {
    if (item.type !== "function_call" || item.name !== "execute_sql" || !item.call_id) continue;
    const args = calls.get(item.call_id)?.args ?? {};
    queries.set(item.call_id, {
      callId: item.call_id,
      title: stringValue(args.title) || "Query result",
      sql: stringValue(args.sql)?.trim() || undefined,
    });
  }
  for (const item of items) {
    const query = item.type === "function_call_output" && item.call_id ? queries.get(item.call_id) : undefined;
    if (!query) continue;
    query.output = typeof item.output === "string" ? item.output : undefined;
    query.messageId = item.metadata?.message_id ?? response.id;
  }

  const charts = items.flatMap((item) => {
    const chart = chartFromItem(item, calls, response.id);
    return chart ? [{ ...chart, query: chart.queryCallId ? queries.get(chart.queryCallId) : undefined }] : [];
  });

  const text = items
    .filter((item) => item.type === "message" && item.role === "assistant")
    .flatMap((item) => item.content ?? [])
    .flatMap((content) => (typeof content.text === "string" && content.text ? [content.text] : []))
    .join("\n\n");

  // Number sources in the order the answer first cites them.
  const numbers = new Map<string, number>();
  for (const match of text.matchAll(CITATION_PATTERN)) {
    const callId = resolveQueryCallId(match[3], calls);
    if (queries.has(callId) && !numbers.has(callId)) numbers.set(callId, numbers.size + 1);
  }

  const answer = text.replace(CITATION_PATTERN, (_whole, _label: string, _url: string, target: string) => {
    const number = numbers.get(resolveQueryCallId(target, calls));
    return number ? `[${number}](${CITATION_HREF}${number})` : "";
  });

  const sources = [...numbers].map(([callId, number]) => ({ ...queries.get(callId)!, number }));
  const chartQueries = new Set(charts.flatMap((chart) => (chart.queryCallId ? [chart.queryCallId] : [])));
  const steps = [...queries.values()].filter((query) => !numbers.has(query.callId) && !chartQueries.has(query.callId));
  return { answer, charts, sources, steps };
}

/** Records a function_call item so later outputs can be matched to their arguments. */
export function recordCall(item: AgentOutputItem, calls: CallIndex): void {
  if (item.type !== "function_call" || !item.call_id) return;
  calls.set(item.call_id, { name: item.name, args: parseArguments(item.arguments) });
}

/** Returns the chart described by a generate_visualization output item, if any. */
export function chartFromItem(item: AgentOutputItem, calls: CallIndex, fallbackMessageId?: string): ResearchChart | undefined {
  const viz = item.type === "function_call_output" ? item.metadata?.viz : undefined;
  const messageId = item.metadata?.message_id ?? fallbackMessageId;
  if (!viz?.attachment_id || !messageId) return undefined;
  const args = item.call_id ? calls.get(item.call_id)?.args ?? {} : {};
  return {
    attachmentId: viz.attachment_id,
    messageId,
    title: stringValue(args.title) || (typeof item.output === "string" && item.output.trim()) || "Genie visualization",
    queryCallId: viz.query_attachment_id ?? (stringValue(args.query_attachment_id) || undefined),
  };
}

/** Returns the source number for a rewritten citation link, or undefined for any other link. */
export function citationNumber(href: string | undefined): number | undefined {
  if (!href?.startsWith(CITATION_HREF)) return undefined;
  const number = Number(href.slice(CITATION_HREF.length));
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

// A citation may point at a chart; its data comes from the chart's query.
function resolveQueryCallId(callId: string, calls: CallIndex): string {
  const call = calls.get(callId);
  if (call?.name === "generate_visualization") return stringValue(call.args.query_attachment_id) || callId;
  return callId;
}

function parseArguments(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
