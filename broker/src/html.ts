import { randomBytes } from "node:crypto";
import type { MessageAuthCarrier } from "./state.js";

interface CompletionMessage {
  type: "genie-sso:mint-complete";
  ok: boolean;
  email: string | null;
  detail: string;
  channelId: string;
}

export interface CompletionPage {
  html: string;
  contentSecurityPolicy: string;
}

export function completionPage(
  carrier: MessageAuthCarrier,
  parentOrigin: string,
  message: CompletionMessage,
): CompletionPage {
  const nonce = randomBytes(18).toString("base64");
  const targetOrigin = parentOrigin === "opaque" ? "*" : parentOrigin;
  const safeMessage = jsonForScript(message);
  const safeTarget = jsonForScript(targetOrigin);
  const destination = carrier === "popup" ? "window.opener" : "window.parent";

  return {
    // Deliberately omit frame-ancestors: the callback must run inside native
    // X-Pages whose parent can have an opaque/file origin. The page contains no
    // token and only emits the correlated boolean completion message.
    contentSecurityPolicy: `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'`,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Databricks connection</title><style nonce="${nonce}">
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f7f8;color:#1b3139;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{text-align:center;padding:28px}.dot{width:12px;height:12px;margin:0 auto 12px;border-radius:50%;background:${message.ok ? "#00a972" : "#d94841"}}
</style></head><body><main><div class="dot"></div><strong>${message.ok ? "Connected to Databricks" : "Connection was not completed"}</strong><p>This window can close.</p></main>
<script nonce="${nonce}">(() => { const target = ${destination}; if (target) target.postMessage(${safeMessage}, ${safeTarget}); ${carrier === "popup" ? "window.close();" : ""} })();</script>
</body></html>`,
  };
}

export function redirectFailurePage(): CompletionPage {
  const nonce = randomBytes(18).toString("base64");
  return {
    contentSecurityPolicy: `default-src 'none'; script-src 'none'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'`,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Databricks connection</title><style nonce="${nonce}">
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f7f8;color:#1b3139;font:15px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:420px;text-align:center;padding:32px}.dot{width:12px;height:12px;margin:0 auto 14px;border-radius:50%;background:#d94841}a{display:inline-block;margin-top:14px;color:#0878c9;font-weight:650}
</style></head><body><main><div class="dot"></div><strong>Databricks sign-in was not completed</strong><p>Return to Vault CRM and use the secure link to try again.</p></main></body></html>`,
  };
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
