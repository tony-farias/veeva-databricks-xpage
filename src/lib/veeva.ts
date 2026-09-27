export async function getSSOAssertion(configurationName: string): Promise<string> {
  const ds = await waitForVeevaBridge(5_000);
  if (!ds?.getSSOAccessToken) throw new Error("veeva_sso_unavailable");

  const result = await withTimeout(
    Promise.resolve(ds.getSSOAccessToken(configurationName)),
    120_000,
    "veeva_sso_timed_out",
  );
  const assertion = findJwt(result);
  if (!assertion) throw new Error("veeva_sso_returned_no_token");
  return assertion;
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

function findJwt(value: unknown, depth = 0, seen = new WeakSet<object>()): string | undefined {
  if (depth > 4 || value == null) return undefined;
  if (typeof value === "string") return value.split(".").length === 3 ? value : undefined;
  if (typeof value !== "object" || seen.has(value)) return undefined;
  seen.add(value);
  const record = value as Record<string, unknown>;
  for (const key of ["accessToken", "access_token", "token", "idToken", "id_token", "data", "result"]) {
    const found = findJwt(record[key], depth + 1, seen);
    if (found) return found;
  }
  return undefined;
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
