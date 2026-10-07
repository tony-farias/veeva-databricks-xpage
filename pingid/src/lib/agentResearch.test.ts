import { describe, expect, it } from "vitest";
import type { AgentOutputItem, AgentResponse } from "../types/genie";
import fixture from "./__fixtures__/agent-research-response.json";
import { chartFromItem, citationNumber, parseAgentResponse, recordCall, type CallIndex } from "./agentResearch";

// A real Agent mode run over the synthetic NSCLC cohort: 10 execute_sql calls,
// 3 generate_visualization calls, and a cited markdown answer.
const response = fixture as AgentResponse;

describe("parseAgentResponse with a captured Agent mode run", () => {
  const report = parseAgentResponse(response);

  it("extracts every chart Genie generated, with the IDs needed to download it", () => {
    expect(report.charts).toHaveLength(3);
    for (const chart of report.charts) {
      expect(chart.attachmentId).toMatch(/^pub_toolu_/);
      expect(chart.messageId).toBe(response.id);
      expect(chart.title).not.toBe("Genie visualization");
      expect(chart.queryCallId).toMatch(/^toolu_/);
    }
    expect(report.charts[0].title).toBe("Cost of Care by Primary Driver: Pharmacy vs Medical");
  });

  it("attaches each chart's query to the chart, keeps cited queries as sources, and folds the rest into research steps", () => {
    const sourceIds = report.sources.map((source) => source.callId);
    const stepIds = report.steps.map((step) => step.callId);
    const chartIds = report.charts.map((chart) => chart.query?.callId);
    for (const chart of report.charts) expect(chart.query?.callId).toBe(chart.queryCallId);
    expect(sourceIds.length).toBeGreaterThan(0);
    expect(new Set([...sourceIds, ...stepIds, ...chartIds]).size).toBe(10);
    expect(stepIds.filter((id) => sourceIds.includes(id) || chartIds.includes(id))).toEqual([]);
    expect(report.sources.map((source) => source.number)).toEqual(report.sources.map((_, index) => index + 1));
    for (const query of [...report.sources, ...report.steps, ...report.charts.map((chart) => chart.query!)]) {
      expect(query.sql).toMatch(/SELECT/i);
      expect(query.output).toContain("|");
      expect(query.messageId).toBe(response.id);
    }
  });

  it("rewrites citations to in-page sources and removes links into the Databricks UI", () => {
    expect(report.answer).not.toMatch(/azuredatabricks\.net|gra_focus|\\\[/);
    const cited = [...report.answer.matchAll(/\[(\d+)\]\(#source-(\d+)\)/g)];
    expect(cited.length).toBeGreaterThan(0);
    for (const match of cited) {
      expect(match[1]).toBe(match[2]);
      expect(Number(match[2])).toBeLessThanOrEqual(report.sources.length);
    }
    expect(report.answer).toMatch(/^## /m);
  });
});

describe("citation rewriting", () => {
  const sql = (callId: string, title: string): AgentOutputItem[] => [
    { type: "function_call", name: "execute_sql", call_id: callId, arguments: JSON.stringify({ title, sql: "SELECT 1" }) },
    { type: "function_call_output", call_id: callId, output: `**${title}**\n\n| a |\n| --- |\n| 1 |`, metadata: { message_id: "m1" } },
  ];
  const answer = (text: string): AgentOutputItem => ({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });
  const link = (label: number, callId: string) => `[${label}](https://example.azuredatabricks.net/genie/rooms/s/chats/c?o=1&gra_focus=${callId})`;

  it("numbers sources by first citation even when Genie reuses a label, and handles escaped and plain forms", () => {
    const report = parseAgentResponse({
      id: "m1",
      output: [...sql("toolu_a", "First"), ...sql("toolu_b", "Second"), answer(`One.\\[${link(1, "toolu_b")}\\] Two.${link(1, "toolu_a")} Again.\\[${link(4, "toolu_b")}\\]`)],
    });
    expect(report.sources.map((source) => [source.number, source.title])).toEqual([[1, "Second"], [2, "First"]]);
    expect(report.answer).toBe("One.[1](#source-1) Two.[2](#source-2) Again.[1](#source-1)");
    expect(report.steps).toEqual([]);
  });

  it("maps a citation of a chart to the chart's query and drops citations it cannot resolve", () => {
    const report = parseAgentResponse({
      id: "m1",
      output: [
        ...sql("toolu_q", "Query"),
        ...sql("toolu_unused", "Unused"),
        { type: "function_call", name: "generate_visualization", call_id: "toolu_v", arguments: JSON.stringify({ title: "Chart", query_attachment_id: "toolu_q" }) },
        { type: "function_call_output", call_id: "toolu_v", output: "Chart", metadata: { message_id: "m1", viz: { attachment_id: "pub_toolu_v_output", query_attachment_id: "toolu_q" } } },
        answer(`See chart.\\[${link(1, "toolu_v")}\\] Missing.\\[${link(2, "toolu_missing")}\\]`),
      ],
    });
    expect(report.answer).toBe("See chart.[1](#source-1) Missing.");
    expect(report.sources.map((source) => source.callId)).toEqual(["toolu_q"]);
    expect(report.steps.map((step) => step.callId)).toEqual(["toolu_unused"]);
    expect(report.charts).toHaveLength(1);
    expect(report.charts[0]).toMatchObject({ attachmentId: "pub_toolu_v_output", messageId: "m1", title: "Chart", queryCallId: "toolu_q" });
    expect(report.charts[0].query).toMatchObject({ callId: "toolu_q", title: "Query", sql: "SELECT 1", messageId: "m1" });
  });

  it("shows an uncited chart's query only as the chart's data", () => {
    const report = parseAgentResponse({
      id: "m1",
      output: [
        ...sql("toolu_q", "Chart query"),
        { type: "function_call", name: "generate_visualization", call_id: "toolu_v", arguments: JSON.stringify({ title: "Chart", query_attachment_id: "toolu_q" }) },
        { type: "function_call_output", call_id: "toolu_v", output: "Chart", metadata: { message_id: "m1", viz: { attachment_id: "pub_toolu_v_output", query_attachment_id: "toolu_q" } } },
        answer("No citations."),
      ],
    });
    expect(report.sources).toEqual([]);
    expect(report.steps).toEqual([]);
    expect(report.charts[0].query?.callId).toBe("toolu_q");
  });

  it("recognizes only rewritten source links as citations", () => {
    expect(citationNumber("#source-3")).toBe(3);
    expect(citationNumber("#source-0")).toBeUndefined();
    expect(citationNumber("https://example.com")).toBeUndefined();
    expect(citationNumber(undefined)).toBeUndefined();
  });
});

describe("chartFromItem while the stream is in progress", () => {
  it("builds a chart from the output item once its call has been recorded", () => {
    const calls: CallIndex = new Map();
    const call: AgentOutputItem = { type: "function_call", name: "generate_visualization", call_id: "toolu_v", arguments: JSON.stringify({ title: "Survival by ECOG", query_attachment_id: "toolu_q" }) };
    const output: AgentOutputItem = { type: "function_call_output", call_id: "toolu_v", output: "Survival by ECOG", metadata: { message_id: "m1", viz: { attachment_id: "pub_toolu_v_output" } } };
    expect(chartFromItem(call, calls)).toBeUndefined();
    recordCall(call, calls);
    expect(chartFromItem(output, calls)).toEqual({ attachmentId: "pub_toolu_v_output", messageId: "m1", title: "Survival by ECOG", queryCallId: "toolu_q" });
    expect(chartFromItem({ type: "function_call_output", call_id: "toolu_x", output: "| a |" }, calls)).toBeUndefined();
  });
});
