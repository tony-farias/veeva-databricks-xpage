// Acquires the Ping Federate SSO access token on the client and hands it to the
// broker. In MyInsights the Veeva X-Pages bridge exposes getSSOAccessToken();
// the returned bearer token already carries the user's mudid. For local testing
// or non-MyInsights hosts, a token can be injected via window.__PING_ACCESS_TOKEN__.
//
// This is the integration seam for the customer: point it at whatever already
// returns the Ping-issued bearer token for the signed-in rep.
export async function getAccessToken(): Promise<string> {
  const injected = window.__PING_ACCESS_TOKEN__;
  if (typeof injected === "string" && injected.trim()) return injected.trim();

  const ds = await waitForVeevaBridge(5_000);
  if (!ds?.getSSOAccessToken) throw new Error("access_token_unavailable");

  const result = await withTimeout(
    Promise.resolve(ds.getSSOAccessToken()),
    20_000,
    "access_token_timed_out",
  );
  const token = findAccessToken(result);
  if (!token) throw new Error("access_token_invalid_response");
  return token;
}

function findAccessToken(value: unknown, depth = 0, seen = new WeakSet<object>()): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (!value || typeof value !== "object" || depth > 5 || seen.has(value)) return undefined;
  seen.add(value);
  const names = new Set(["accesstoken", "access_token", "token", "bearertoken", "bearer", "ssotoken"]);
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (names.has(normalizeKey(key)) && typeof child === "string" && child.trim()) return child.trim();
  }
  for (const child of Object.values(record)) {
    const found = findAccessToken(child, depth + 1, seen);
    if (found) return found;
  }
  return undefined;
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

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
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
