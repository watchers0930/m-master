/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, Buffer */
require("../../visibility/__tests__/register.cjs");
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { encryptSecret, decryptSecret, maskSecret, CredentialCryptoError } = require("../credentials.ts");

const SECRET_A = "a".repeat(32) + "-test-secret-alpha";
const SECRET_B = "b".repeat(32) + "-test-secret-bravo";

beforeEach(() => {
  process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET_A;
});

function assertReason(fn, reason) {
  assert.throws(fn, (error) => error instanceof CredentialCryptoError && error.reason === reason);
}

test("round trip", () => {
  const plain = "naver-api-secret-값-1234";
  const blob = encryptSecret(plain);
  assert.match(blob, /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
  assert.equal(blob.includes(plain), false);
  const [, iv, tag] = blob.split(":");
  assert.equal(Buffer.from(iv, "base64").length, 12);
  assert.equal(Buffer.from(tag, "base64").length, 16);
  assert.equal(decryptSecret(blob), plain);
});

test("different iv each call", () => {
  const first = encryptSecret("same");
  const second = encryptSecret("same");
  assert.notEqual(first, second);
  assert.notEqual(first.split(":")[1], second.split(":")[1]);
  assert.equal(decryptSecret(first), "same");
  assert.equal(decryptSecret(second), "same");
});

test("tampered tag throws invalid_blob", () => {
  const parts = encryptSecret("secret").split(":");
  const tag = Buffer.from(parts[2], "base64");
  tag[0] ^= 0xff;
  parts[2] = tag.toString("base64");
  assertReason(() => decryptSecret(parts.join(":")), "invalid_blob");
});

test("wrong secret throws invalid_blob", () => {
  const blob = encryptSecret("secret");
  process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET_B;
  assertReason(() => decryptSecret(blob), "invalid_blob");
  process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET_A;
  assert.equal(decryptSecret(blob), "secret");
});

test("value without v1 prefix throws invalid_blob", () => {
  assertReason(() => decryptSecret("plain-legacy-token"), "invalid_blob");
  assertReason(() => decryptSecret(""), "invalid_blob");
  const parts = encryptSecret("secret").split(":");
  assertReason(() => decryptSecret(["v2", ...parts.slice(1)].join(":")), "invalid_blob");
  assertReason(() => decryptSecret(parts.slice(0, 3).join(":")), "invalid_blob");
});

test("missing env throws not_configured on encrypt and decrypt", () => {
  const blob = encryptSecret("secret");
  delete process.env.CREDENTIAL_ENCRYPTION_SECRET;
  assertReason(() => encryptSecret("secret"), "not_configured");
  assertReason(() => decryptSecret(blob), "not_configured");
  process.env.CREDENTIAL_ENCRYPTION_SECRET = "too-short-secret";
  assertReason(() => encryptSecret("secret"), "not_configured");
  assertReason(() => decryptSecret(blob), "not_configured");
});

test("error message never contains secret or plaintext", () => {
  const blob = encryptSecret("super-plain-value");
  process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET_B;
  try {
    decryptSecret(blob);
    assert.fail("expected throw");
  } catch (error) {
    assert.equal(String(error.message).includes(SECRET_B), false);
    assert.equal(String(error.message).includes("super-plain-value"), false);
  }
});

test("mask keeps last 4", () => {
  assert.equal(maskSecret("abcdef123456"), "••••3456");
  assert.equal(maskSecret("abc"), "••••");
  assert.equal(maskSecret(""), "••••");
});
