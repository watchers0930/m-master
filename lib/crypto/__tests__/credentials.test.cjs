/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, Buffer */
require("../../visibility/__tests__/register.cjs");
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  encryptSecret,
  decryptSecret,
  maskSecret,
  credentialKeyId,
  CredentialCryptoError,
} = require("../credentials.ts");

const SECRET_A = Buffer.alloc(32, 7).toString("base64");
const SECRET_B = Buffer.alloc(32, 9).toString("base64");
const CTX = "channel_credentials.refresh_token:owner-1:naver";

beforeEach(() => {
  process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET_A;
});

function assertReason(fn, reason) {
  assert.throws(fn, (error) => error instanceof CredentialCryptoError && error.reason === reason);
}

function segments(blob) {
  return blob.split(":");
}

function mutate(blob, index, fn) {
  const parts = segments(blob);
  parts[index] = fn(parts[index]);
  return parts.join(":");
}

function bytes(b64, fn) {
  const buf = Buffer.from(b64, "base64");
  return fn(buf).toString("base64");
}

test("round trip", () => {
  const plain = "naver-api-secret-값-1234";
  const blob = encryptSecret(plain, CTX);
  const parts = segments(blob);
  assert.equal(parts.length, 5);
  assert.equal(parts[0], "v1");
  assert.match(parts[1], /^[0-9a-f]{16}$/);
  assert.equal(parts[1], credentialKeyId());
  assert.equal(Buffer.from(parts[2], "base64").length, 12);
  assert.equal(Buffer.from(parts[3], "base64").length, 16);
  assert.equal(blob.includes(plain), false);
  assert.equal(decryptSecret(blob, CTX), plain);
});

test("different iv each call", () => {
  const first = encryptSecret("same", CTX);
  const second = encryptSecret("same", CTX);
  assert.notEqual(segments(first)[2], segments(second)[2]);
  assert.equal(decryptSecret(first, CTX), "same");
  assert.equal(decryptSecret(second, CTX), "same");
});

test("tampered tag throws invalid_blob", () => {
  const blob = mutate(encryptSecret("secret", CTX), 3, (t) => bytes(t, (b) => ((b[0] ^= 0xff), b)));
  assertReason(() => decryptSecret(blob, CTX), "invalid_blob");
});

test("ciphertext bit flip throws invalid_blob", () => {
  const blob = mutate(encryptSecret("secret", CTX), 4, (c) => bytes(c, (b) => ((b[0] ^= 0x01), b)));
  assertReason(() => decryptSecret(blob, CTX), "invalid_blob");
});

test("different context throws invalid_blob", () => {
  const blob = encryptSecret("secret", CTX);
  assertReason(() => decryptSecret(blob, "channel_credentials.refresh_token:owner-2:naver"), "invalid_blob");
});

test("wrong secret throws key_mismatch, original secret still decrypts", () => {
  const blob = encryptSecret("secret", CTX);
  process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET_B;
  assertReason(() => decryptSecret(blob, CTX), "key_mismatch");
  process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET_A;
  assert.equal(decryptSecret(blob, CTX), "secret");
});

test("same kid but forged ciphertext throws invalid_blob", () => {
  const blob = encryptSecret("secret", CTX);
  process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET_B;
  const other = encryptSecret("secret", CTX);
  process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET_A;
  const forged = mutate(other, 1, () => segments(blob)[1]);
  assertReason(() => decryptSecret(forged, CTX), "invalid_blob");
});

test("truncated tag and iv are rejected", () => {
  const blob = encryptSecret("secret", CTX);
  assertReason(() => decryptSecret(mutate(blob, 3, (t) => bytes(t, (b) => b.subarray(0, 15))), CTX), "invalid_blob");
  assertReason(() => decryptSecret(mutate(blob, 2, (iv) => bytes(iv, (b) => b.subarray(0, 11))), CTX), "invalid_blob");
});

test("non-canonical base64 and garbage are rejected", () => {
  const blob = encryptSecret("secret", CTX);
  const stripped = mutate(blob, 3, (t) => t.replace(/=+$/, ""));
  assert.notEqual(stripped, blob);
  assertReason(() => decryptSecret(stripped, CTX), "invalid_blob");
  assertReason(() => decryptSecret(mutate(blob, 4, () => ""), CTX), "invalid_blob");
  assertReason(() => decryptSecret(`v1:zz:!!!:???:***`, CTX), "invalid_blob");
  assertReason(() => decryptSecret(mutate(blob, 1, () => "ZZZZZZZZZZZZZZZZ"), CTX), "invalid_blob");
});

test("wrong prefix or segment count throws invalid_blob", () => {
  const blob = encryptSecret("secret", CTX);
  const parts = segments(blob);
  assertReason(() => decryptSecret("plain-legacy-token", CTX), "invalid_blob");
  assertReason(() => decryptSecret("", CTX), "invalid_blob");
  assertReason(() => decryptSecret(["v2", ...parts.slice(1)].join(":"), CTX), "invalid_blob");
  assertReason(() => decryptSecret(parts.slice(0, 4).join(":"), CTX), "invalid_blob");
  assertReason(() => decryptSecret([...parts, "x"].join(":"), CTX), "invalid_blob");
  // 구 형식(kid 없는 4조각)도 거부
  assertReason(() => decryptSecret([parts[0], ...parts.slice(2)].join(":"), CTX), "invalid_blob");
});

test("missing env throws not_configured on encrypt and decrypt", () => {
  const blob = encryptSecret("secret", CTX);
  delete process.env.CREDENTIAL_ENCRYPTION_SECRET;
  assertReason(() => encryptSecret("secret", CTX), "not_configured");
  assertReason(() => decryptSecret(blob, CTX), "not_configured");
  assertReason(() => credentialKeyId(), "not_configured");
});

test("env missing + garbage blob throws not_configured", () => {
  delete process.env.CREDENTIAL_ENCRYPTION_SECRET;
  assertReason(() => decryptSecret("garbage", CTX), "not_configured");
});

test("malformed env secret throws not_configured", () => {
  const bad = [
    SECRET_A + "\n",
    SECRET_A + "\\n",
    " " + SECRET_A,
    SECRET_A + " ",
    SECRET_A.slice(0, 20) + " " + SECRET_A.slice(20),
    SECRET_A + "\t",
    "not-base64-!!!-" + "x".repeat(40),
    Buffer.alloc(31, 7).toString("base64"),
    Buffer.alloc(33, 7).toString("base64"),
    SECRET_A.replace(/=+$/, ""),
    "a".repeat(64),
    "",
  ];
  for (const value of bad) {
    process.env.CREDENTIAL_ENCRYPTION_SECRET = value;
    assertReason(() => encryptSecret("secret", CTX), "not_configured");
    assertReason(() => credentialKeyId(), "not_configured");
  }
});

test("invalid_input for non-string or empty inputs without echoing value", () => {
  const blob = encryptSecret("secret", CTX);
  const cases = [
    () => encryptSecret(123456789, CTX),
    () => encryptSecret("", CTX),
    () => encryptSecret("secret", 123456789),
    () => encryptSecret("secret", ""),
    () => encryptSecret("secret"),
    () => decryptSecret(123456789, CTX),
    () => decryptSecret(blob, 123456789),
    () => decryptSecret(blob, ""),
    () => decryptSecret(blob),
  ];
  for (const fn of cases) {
    assert.throws(fn, (error) => {
      assert.ok(error instanceof CredentialCryptoError);
      assert.equal(error.reason, "invalid_input");
      assert.equal(String(error.message).includes("123456789"), false);
      return true;
    });
  }
});

test("invalid_input check precedes env check", () => {
  delete process.env.CREDENTIAL_ENCRYPTION_SECRET;
  assertReason(() => encryptSecret("", CTX), "invalid_input");
  assertReason(() => decryptSecret("x", ""), "invalid_input");
});

test("error never contains secret, plaintext or context", () => {
  const blob = encryptSecret("super-plain-value", CTX);
  process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET_B;
  const check = (error) => {
    assert.ok(error instanceof CredentialCryptoError);
    for (const text of [error.message, String(error.stack), String(error), JSON.stringify(error)]) {
      for (const needle of [SECRET_A, SECRET_B, "super-plain-value", CTX]) {
        assert.equal(text.includes(needle), false);
      }
    }
    return true;
  };
  assert.throws(() => decryptSecret(blob, CTX), check);
  process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET_B + "\n";
  assert.throws(() => encryptSecret("super-plain-value", CTX), check);
});

test("credentialKeyId stable per secret and 16 hex chars", () => {
  const a1 = credentialKeyId();
  const a2 = credentialKeyId();
  assert.match(a1, /^[0-9a-f]{16}$/);
  assert.equal(a1, a2);
  process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET_B;
  const b = credentialKeyId();
  assert.match(b, /^[0-9a-f]{16}$/);
  assert.notEqual(a1, b);
});

test("mask keeps last 4 only above 8 chars", () => {
  assert.equal(maskSecret("abcdef123456"), "••••3456");
  assert.equal(maskSecret("12345678"), "••••");
  assert.equal(maskSecret("123456789"), "••••6789");
  assert.equal(maskSecret("abc"), "••••");
  assert.equal(maskSecret(""), "••••");
  assert.equal(maskSecret("가나다라마바사아"), "••••");
  assert.equal(maskSecret("가나다라마바사아자"), "••••바사아자");
});

test("blob that would decrypt to empty string throws invalid_blob", () => {
  const crypto = require("node:crypto");
  const key = Buffer.from(crypto.hkdfSync("sha256", Buffer.alloc(32, 7), "minteq-credentials", "v1", 32));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(CTX, "utf8"));
  const ct = Buffer.concat([cipher.update("", "utf8"), cipher.final()]);
  const blob = ["v1", credentialKeyId(), iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
  assertReason(() => decryptSecret(blob, CTX), "invalid_blob");
});
