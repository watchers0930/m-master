import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// 채널 자격증명·광고 API 키 암호화 (AES-256-GCM).
// 저장 형식: v1:<iv b64>:<tag b64>:<ct b64>
// 실패는 절대 삼키지 않는다(fail-closed). 에러 메시지에 키·평문·암호문을 넣지 않는다.

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const MIN_SECRET_LENGTH = 32;
const HKDF_SALT = "minteq-credentials";
const HKDF_INFO = "v1";
const MASK = "••••";

export type CredentialCryptoReason = "not_configured" | "invalid_blob";

export class CredentialCryptoError extends Error {
  readonly reason: CredentialCryptoReason;

  constructor(reason: CredentialCryptoReason) {
    super(`credential_crypto_${reason}`);
    this.name = "CredentialCryptoError";
    this.reason = reason;
  }
}

// 파생 키 캐시: secret 값이 바뀌면(키 교체·테스트) 자동으로 다시 파생한다.
let cached: { secret: string; key: Buffer } | null = null;

function deriveKey(): Buffer {
  const secret = process.env.CREDENTIAL_ENCRYPTION_SECRET ?? "";
  if (secret.length < MIN_SECRET_LENGTH) throw new CredentialCryptoError("not_configured");
  if (cached?.secret === secret) return cached.key;
  const key = Buffer.from(hkdfSync("sha256", secret, HKDF_SALT, HKDF_INFO, KEY_BYTES));
  cached = { secret, key };
  return key;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function decodePart(part: string): Buffer {
  if (!BASE64.test(part)) throw new CredentialCryptoError("invalid_blob");
  return Buffer.from(part, "base64");
}

export function encryptSecret(plain: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(blob: string): string {
  // env 누락은 형식 오류보다 먼저 알린다(운영 설정 문제를 데이터 문제로 오인하지 않도록).
  const key = deriveKey();
  const parts = typeof blob === "string" ? blob.split(":") : [];
  if (parts.length !== 4 || parts[0] !== VERSION) throw new CredentialCryptoError("invalid_blob");
  const iv = decodePart(parts[1]);
  const tag = decodePart(parts[2]);
  const ct = decodePart(parts[3]);
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new CredentialCryptoError("invalid_blob");
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    // 인증 실패(키 불일치·변조)는 원인 노출 없이 invalid_blob으로만 알린다.
    throw new CredentialCryptoError("invalid_blob");
  }
}

// 화면 표시용: 뒤 4자리만 보인다. 4자 이하 값은 전체 노출을 막기 위해 마스크만 반환한다.
export function maskSecret(plain: string): string {
  if (plain.length <= 4) return MASK;
  return MASK + plain.slice(-4);
}
