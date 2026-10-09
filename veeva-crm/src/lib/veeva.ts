export interface SalesforceSession {
  sessionId: string;
  instanceUrl: string;
  isSandbox?: boolean;
}

// MyInsights resolves getSFDCSessionID() with
// { success: true, data: { sessionId, instanceURL, isSandbox } } and rejects
// with { success: false, code, message } when it cannot refresh the session.
export async function getSalesforceSession(): Promise<SalesforceSession> {
  const ds = await waitForVeevaBridge(5_000);
  if (!ds?.getSFDCSessionID) throw new Error("veeva_crm_session_unavailable");

  let result: unknown;
  try {
    result = await withTimeout(
      Promise.resolve(ds.getSFDCSessionID()),
      20_000,
      "veeva_crm_session_timed_out",
    );
  } catch (error) {
    if (error instanceof Error && error.message === "veeva_crm_session_timed_out") throw error;
    throw new Error("veeva_crm_session_refused");
  }
  if (result && typeof result === "object" && (result as Record<string, unknown>).success === false) {
    throw new Error("veeva_crm_session_refused");
  }
  const sessionId = findNamedString(result, new Set(["sessionid"]));
  const instanceUrl = findNamedString(result, new Set(["instanceurl"]));
  if (!sessionId || !instanceUrl) throw new Error("veeva_crm_session_invalid_response");

  let parsed: URL;
  try {
    parsed = new URL(instanceUrl.includes("://") ? instanceUrl : `https://${instanceUrl}`);
  } catch {
    throw new Error("veeva_crm_session_invalid_response");
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocalhost(parsed.hostname))) {
    throw new Error("veeva_crm_session_invalid_response");
  }

  return {
    sessionId,
    instanceUrl: parsed.origin,
    isSandbox: findNamedBoolean(result, new Set(["issandbox", "sandbox"])),
  };
}

function waitForVeevaBridge(timeoutMs = 1_500): Promise<VeevaDataService | undefined> {
  if (window.ds) return Promise.resolve(window.ds);
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (window.ds || Date.now() - started >= timeoutMs) {
        window.clearInterval(timer);
        resolve(window.ds);
      }
    }, 50);
  });
}

function findNamedString(
  value: unknown,
  names: ReadonlySet<string>,
  depth = 0,
  seen = new WeakSet<object>(),
): string | undefined {
  if (!value || typeof value !== "object" || depth > 5 || seen.has(value)) return undefined;
  seen.add(value);
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (names.has(normalizeKey(key)) && typeof child === "string" && child.trim()) return child.trim();
  }
  for (const child of Object.values(record)) {
    const found = findNamedString(child, names, depth + 1, seen);
    if (found) return found;
  }
  return undefined;
}

function findNamedBoolean(
  value: unknown,
  names: ReadonlySet<string>,
  depth = 0,
  seen = new WeakSet<object>(),
): boolean | undefined {
  if (!value || typeof value !== "object" || depth > 5 || seen.has(value)) return undefined;
  seen.add(value);
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (names.has(normalizeKey(key)) && typeof child === "boolean") return child;
  }
  for (const child of Object.values(record)) {
    const found = findNamedBoolean(child, names, depth + 1, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}
