import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

// 채널 자격증명·광고 API 키 암호화 (AES-256-GCM, context를 AAD로 묶음).
// 저장 형식: v1:<kid>:<iv b64>:<tag b64>:<ct b64>
// 실패는 절대 삼키지 않는다(fail-closed). 에러 메시지는 고정 문자열이며 키·평문·암호문·context를 넣지 않는다.

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const HKDF_SALT = "minteq-credentials";
const HKDF_INFO = "v1";
const KID_PATTERN = /^[0-9a-f]{16}$/;

export type CredentialCryptoReason = "not_configured" | "invalid_blob" | "key_mismatch" | "invalid_input";

export class CredentialCryptoError extends Error {
  readonly reason: CredentialCryptoReason;

  constructor(reason: CredentialCryptoReason) {
    super(`credential_crypto_${reason}`);
    this.name = "CredentialCryptoError";
    this.reason = reason;
  }
}

type DerivedKey = { secret: string; key: Buffer; kid: string };

// 파생 키 캐시: secret 문자열이 바뀌면(키 교체·테스트) 자동으로 다시 파생한다.
let cached: DerivedKey | null = null;

// 정규(canonical) base64인지 확인한다. 공백·개행·패딩 누락·잘못된 문자는 모두 거부.
function decodeCanonical(value: string): Buffer | null {
  if (value.length === 0) return null;
  const buf = Buffer.from(value, "base64");
  return buf.toString("base64") === value ? buf : null;
}

function currentKey(): DerivedKey {
  // 절대 trim하지 않는다: 끝 개행 등 env 오염은 설정 오류로 드러나야 한다.
  const secret = process.env.CREDENTIAL_ENCRYPTION_SECRET ?? "";
  if (cached?.secret === secret) return cached;
  const raw = decodeCanonical(secret);
  if (!raw || raw.length !== KEY_BYTES) throw new CredentialCryptoError("not_configured");
  const key = Buffer.from(hkdfSync("sha256", raw, HKDF_SALT, HKDF_INFO, KEY_BYTES));
  const kid = createHmac("sha256", key).update("kid").digest().subarray(0, 8).toString("hex");
  cached = { secret, key, kid };
  return cached;
}

function assertContext(context: unknown): asserts context is string {
  if (typeof context !== "string" || context.length === 0) throw new CredentialCryptoError("invalid_input");
}

// 환경 간 키 일치 여부를 비밀값 노출 없이 비교하기 위한 식별자.
export function credentialKeyId(): string {
  return currentKey().kid;
}

export type CredentialKeyStatus = { kid: string | null; writable: boolean; reason?: "not_configured" | "key_mismatch" };

// 운영 런타임 키 확인용(읽기 전용): kid(비밀 아님)와 쓰기 가능 여부만. 비밀값·KEY_ID 원문은 담지 않는다.
export function credentialKeyStatus(): CredentialKeyStatus {
  let kid: string;
  try { kid = currentKey().kid; } catch { return { kid: null, writable: false, reason: "not_configured" }; }
  try { assertWriteKeyId(kid); } catch (error) {
    const reason = error instanceof CredentialCryptoError && error.reason === "key_mismatch" ? "key_mismatch" : "not_configured";
    return { kid, writable: false, reason };
  }
  return { kid, writable: true };
}

// 쓰기 가능 여부(키 형식 + CREDENTIAL_KEY_ID 일치)를 값 노출 없이 확인. 실패 시 CredentialCryptoError.
export function assertCredentialWritable(): string {
  const { kid } = currentKey();
  assertWriteKeyId(kid);
  return kid;
}

// 쓰기 전용 가드: 비밀값이 아닌 env CREDENTIAL_KEY_ID(16 hex)가 현재 키의 kid와 같아야 암호화한다.
// 환경마다 다른 키로 운영 DB(공유)에 새 암호문을 쓰는 사고(2026-09-10 PII 키 불일치 유형)를 원천 차단한다.
// 읽기(decryptSecret)는 요구하지 않는다 — blob 자체의 kid로 불일치를 판별한다.
function assertWriteKeyId(kid: string): void {
  const expected = process.env.CREDENTIAL_KEY_ID ?? "";
  if (!KID_PATTERN.test(expected)) throw new CredentialCryptoError("not_configured");
  if (expected !== kid) throw new CredentialCryptoError("key_mismatch");
}

export function encryptSecret(plain: string, context: string): string {
  if (typeof plain !== "string" || plain.length === 0) throw new CredentialCryptoError("invalid_input");
  assertContext(context);
  const { key, kid } = currentKey();
  assertWriteKeyId(kid);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, kid, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(blob: string, context: string): string {
  if (typeof blob !== "string") throw new CredentialCryptoError("invalid_input");
  assertContext(context);
  // env 누락은 형식 오류보다 먼저 알린다(운영 설정 문제를 데이터 문제로 오인하지 않도록).
  const { key, kid } = currentKey();
  const parts = blob.split(":");
  if (parts.length !== 5 || parts[0] !== VERSION || !KID_PATTERN.test(parts[1])) {
    throw new CredentialCryptoError("invalid_blob");
  }
  if (parts[1] !== kid) throw new CredentialCryptoError("key_mismatch");
  const iv = decodeCanonical(parts[2]);
  const tag = decodeCanonical(parts[3]);
  const ct = decodeCanonical(parts[4]);
  if (!iv || !tag || !ct || iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new CredentialCryptoError("invalid_blob");
  }
  let plain: string;
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(tag);
    plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    // 인증 실패(변조·context 불일치)는 원인 노출 없이 invalid_blob으로만 알린다.
    throw new CredentialCryptoError("invalid_blob");
  }
  if (plain.length === 0) throw new CredentialCryptoError("invalid_blob");
  return plain;
}

// 화면 표시용 마스킹은 순수 모듈(클라이언트 공용)에 있다.
export { maskSecret } from "./mask";
