import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface ApiSession {
  accessToken: string;
  actorUserName: string;
  actorDisplayName: string | null;
  executionApplicationId: string;
  executionDisplayName: string;
  sessionId: string;
  expiresAt: number;
}

const VERSION = "sp1";

export function sealApiSession(session: ApiSession, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), ciphertext.toString("base64url"), tag.toString("base64url")].join(".");
}

export function openApiSession(value: string, secret: string, now = Date.now()): ApiSession {
  const [version, ivText, ciphertextText, tagText, extra] = value.split(".");
  if (version !== VERSION || !ivText || !ciphertextText || !tagText || extra) throw new Error("invalid_session");

  try {
    const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(plaintext) as Partial<ApiSession>;
    if (
      typeof parsed.accessToken !== "string" ||
      typeof parsed.actorUserName !== "string" ||
      (parsed.actorDisplayName !== null && typeof parsed.actorDisplayName !== "string") ||
      typeof parsed.executionApplicationId !== "string" ||
      typeof parsed.executionDisplayName !== "string" ||
      typeof parsed.sessionId !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= now
    ) throw new Error("invalid_session");
    return parsed as ApiSession;
  } catch {
    throw new Error("invalid_session");
  }
}

function key(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}
