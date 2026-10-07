// Azure Functions (Node.js v4 programming model) host for the broker.
//
// One catch-all HTTP trigger forwards every request to the unchanged Express
// app, which listens on a loopback port inside the same worker process. Status,
// headers, and body pass through untouched, and response bodies are streamed so
// Agent-mode event streams are not buffered by the Function host.
//
// Kong remains the only caller. By default the trigger also requires a function
// key, which Kong adds as the x-functions-key header; set
// BROKER_FUNCTION_AUTH_LEVEL=anonymous when network restrictions alone keep the
// Function App private.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
// @azure/functions is CommonJS; import it whole so this ES module loads in Node.
import functions, { type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { createBrokerApp } from "../app.js";
import { loadConfig } from "../config.js";

const { app } = functions;

app.setup({ enableHttpStream: true });

// Connection-level headers belong to each hop and must not be forwarded. The
// function key authenticates Kong to the Function host only.
const HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-functions-key",
]);

let brokerOrigin: Promise<string> | undefined;

function startBroker(): Promise<string> {
  brokerOrigin ??= new Promise<string>((resolve, reject) => {
    const server = createServer(createBrokerApp(loadConfig()));
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  }).catch((error: unknown) => {
    // Let the next invocation retry, for example after a missing app setting is added.
    brokerOrigin = undefined;
    throw error;
  });
  return brokerOrigin;
}

export async function forwardToBroker(request: HttpRequest): Promise<HttpResponseInit> {
  const origin = await startBroker();
  const { pathname, search } = new URL(request.url);
  const headers = new Headers();
  request.headers.forEach((value, name) => {
    if (!HOP_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  });
  const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.body !== null;
  const upstream = await fetch(`${origin}${pathname}${search}`, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: "manual",
    ...(hasBody ? { duplex: "half" } : {}),
  } as RequestInit);
  const responseHeaders: Record<string, string> = {};
  upstream.headers.forEach((value, name) => {
    if (!HOP_HEADERS.has(name.toLowerCase())) responseHeaders[name] = value;
  });
  return { status: upstream.status, headers: responseHeaders, body: upstream.body ?? undefined };
}

app.http("broker", {
  route: "{*path}",
  methods: ["GET", "POST", "OPTIONS"],
  authLevel: process.env.BROKER_FUNCTION_AUTH_LEVEL === "anonymous" ? "anonymous" : "function",
  handler: forwardToBroker,
});
