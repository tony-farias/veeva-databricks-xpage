import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type MessageAuthCarrier = "iframe" | "popup";
export type AuthCarrier = MessageAuthCarrier | "redirect";

export interface MessageAuthState {
  verifier: string;
  carrier: MessageAuthCarrier;
  parentOrigin: string;
  channelId: string;
  expiresAt: number;
}

export interface RedirectAuthState {
  verifier: string;
  carrier: "redirect";
  expiresAt: number;
}

export type AuthState = MessageAuthState | RedirectAuthState;

const VERSION = "v1";

/**
 * Keep PKCE and routing state inside authenticated encryption rather than a
 * third-party broker cookie. This lets the silent iframe survive browsers that
 * partition or block cookies belonging to the broker domain.
 */
export function sealState(state: AuthState, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), ciphertext.toString("base64url"), tag.toString("base64url")].join(".");
}

export function openState(value: string, secret: string, now = Date.now()): AuthState {
  const [version, ivText, ciphertextText, tagText, extra] = value.split(".");
  if (version !== VERSION || !ivText || !ciphertextText || !tagText || extra) throw new Error("invalid_state");

  try {
    const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(plaintext) as Partial<AuthState>;
    if (typeof parsed.verifier !== "string" || typeof parsed.expiresAt !== "number" || parsed.expiresAt < now) {
      throw new Error("invalid_state");
    }

    if (parsed.carrier === "redirect") return parsed as RedirectAuthState;

    if (
      (parsed.carrier !== "iframe" && parsed.carrier !== "popup") ||
      typeof parsed.parentOrigin !== "string" ||
      typeof parsed.channelId !== "string"
    ) throw new Error("invalid_state");

    return parsed as AuthState;
  } catch {
    throw new Error("invalid_state");
  }
}

function key(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}
