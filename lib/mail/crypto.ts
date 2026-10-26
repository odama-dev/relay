import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env, isProduction } from "@/lib/env";

/**
 * Mailbox passwords at rest: AES-256-GCM with MAIL_ENCRYPTION_KEY, stored as
 * "v1:iv:tag:ciphertext" (base64). Development without a key derives one so
 * local flows work; production refuses.
 */
function key(): Buffer {
  if (env.mailEncryptionKey) {
    const k = Buffer.from(env.mailEncryptionKey, "base64");
    if (k.length !== 32) throw new Error("MAIL_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
    return k;
  }
  if (isProduction) throw new Error("Mail isn't configured (MAIL_ENCRYPTION_KEY).");
  return createHash("sha256").update(`odama-os-dev-mail:${env.supabaseServiceRoleKey}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unreadable mailbox password — reconnect the mailbox.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
