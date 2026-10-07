// Acquires the Ping Federate SSO access token on the client. Kong validates
// this token on every broker call, so the client sends it on every request and
// keeps it fresh. The token's `sub` claim identifies the user.
//
// In MyInsights / X-Pages the Veeva bridge exposes
// ds.getSSOAccessToken(authIdentifier, providerName, oldToken), which resolves
// { success, data: { token } }. Passing the previously issued token as
// oldToken asks the bridge for a refreshed one. The authIdentifier and
// providerName come from xpage-config.js (ssoAuthIdentifier, ssoProviderName).
//
// For local testing or non-MyInsights hosts, a token can be injected via
// window.__PING_ACCESS_TOKEN__; it is used as-is and never refreshed.

export interface SsoProvider {
  authIdentifier: string;
  providerName: string;
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

const REFRESH_MARGIN_MS = 60_000;
// Tokens without an exp claim are re-requested from the bridge this often.
const UNKNOWN_EXPIRY_MS = 5 * 60_000;

let cached: CachedToken | undefined;
let pending: Promise<string> | undefined;

export function hasInjectedAccessToken(): boolean {
  const injected = window.__PING_ACCESS_TOKEN__;
  return typeof injected === "string" && Boolean(injected.trim());
}

export function clearAccessToken(): void {
  cached = undefined;
}

// Returns a Ping token valid for at least another minute. forceRefresh skips
// the cache and asks the bridge for a new token (used after a 401 from Kong).
export async function getAccessToken(provider: SsoProvider, forceRefresh = false): Promise<string> {
  const injected = window.__PING_ACCESS_TOKEN__;
  if (typeof injected === "string" && injected.trim()) return injected.trim();

  if (!forceRefresh && cached && cached.expiresAtMs - Date.now() > REFRESH_MARGIN_MS) return cached.token;
  // Concurrent requests share one bridge round trip.
  if (pending) return pending;
  pending = acquire(provider, forceRefresh).finally(() => {
    pending = undefined;
  });
  return pending;
}

async function acquire(provider: SsoProvider, forceRefresh: boolean): Promise<string> {
  const ds = await waitForVeevaBridge(5_000);
  if (!ds?.getSSOAccessToken) throw new Error("access_token_unavailable");
  if (!provider.authIdentifier || !provider.providerName) throw new Error("sso_provider_not_configured");

  // The bridge first returns the token it currently holds. If that one is
  // expiring (or Kong just rejected it), hand it back as oldToken to force a
  // refresh.
  const current = await requestToken(ds, provider, null);
  if (!forceRefresh && remainingMs(current) > REFRESH_MARGIN_MS) return remember(current);

  const refreshed = await requestToken(ds, provider, current);
  if (remainingMs(refreshed) <= 0) throw new Error("access_token_expired");
  return remember(refreshed);
}

async function requestToken(ds: VeevaDataService, provider: SsoProvider, oldToken: string | null): Promise<string> {
  if (!ds.getSSOAccessToken) throw new Error("access_token_unavailable");
  const result = await withTimeout(
    Promise.resolve(ds.getSSOAccessToken(provider.authIdentifier, provider.providerName, oldToken)),
    20_000,
    "access_token_timed_out",
  );
  if (result && typeof result === "object" && (result as { success?: unknown }).success === false) {
    throw new Error("access_token_rejected");
  }
  const token = (result as VeevaSsoTokenResponse | undefined)?.data?.token?.trim() || findAccessToken(result);
  if (!token) throw new Error("access_token_invalid_response");
  return token;
}

function remember(token: string): string {
  const expiry = tokenExpiryMs(token);
  cached = { token, expiresAtMs: expiry ?? Date.now() + UNKNOWN_EXPIRY_MS };
  return token;
}

function remainingMs(token: string): number {
  const expiry = tokenExpiryMs(token);
  return expiry === undefined ? UNKNOWN_EXPIRY_MS : expiry - Date.now();
}

function tokenExpiryMs(token: string): number | undefined {
  const segment = token.split(".")[1];
  if (!segment) return undefined;
  try {
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(segment.length / 4) * 4, "=");
    const payload = JSON.parse(atob(base64)) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1_000 : undefined;
  } catch {
    return undefined;
  }
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

export function waitForVeevaBridge(timeoutMs = 1_500): Promise<VeevaDataService | undefined> {
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
