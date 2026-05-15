import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

function getKey() {
  const secret = process.env.CREDENTIAL_ENCRYPTION_SECRET?.trim();

  if (!secret) {
    throw new Error("CREDENTIAL_ENCRYPTION_SECRET 환경변수가 필요합니다.");
  }

  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptSecret(plainText: string) {
  const normalized = plainText.trim();

  if (!normalized) {
    return undefined;
  }

  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `v1:${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(payload?: string | null) {
  if (!payload) {
    return undefined;
  }

  const [version, ivBase64, authTagBase64, encryptedBase64] = payload.split(":");

  if (version !== "v1" || !ivBase64 || !authTagBase64 || !encryptedBase64) {
    throw new Error("저장된 자격증명 형식이 올바르지 않습니다.");
  }

  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivBase64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
