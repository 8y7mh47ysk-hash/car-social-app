import { describe, expect, it } from "vitest";

import { REDACTED, isSensitiveKey, redactUrls } from "./redact.ts";

describe("isSensitiveKey", () => {
  it.each([
    "password",
    "PASSWORD",
    "newPassword",
    "password_hash",
    "passwd",
    "passphrase",
    "client_secret",
    "stripeSecretKey",
    "webhookSecret",
    "credentials",
    "apiKey",
    "API_KEY",
    "x-api-key",
    "privateKey",
    "encryptionKey",
    "signingKey",
    "masterKey",
    "recoveryCodes",
    "token",
    "accessToken",
    "refresh_token",
    "idToken",
    "x-csrf-token",
    "tokens",
    "jwt",
    "authorization",
    "Authorization",
    "proxy-authorization",
    "cookie",
    "Cookie",
    "cookies",
    "set-cookie",
    "sessionId",
    "x-session-id",
    "otp",
    "totp",
    "stripe-signature",
    "x-hub-signature",
    "x-hub-signature-256",
    "cf-access-jwt-assertion",
    "Cf-Access-Jwt-Assertion",
    "client_assertion",
    "code_verifier",
    "codeVerifier",
    "csrf",
    "_csrf",
    "auth",
    "pass",
    "pwd",
    "rawPacket",
    "rawHeaders",
  ])("treats %j as sensitive", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each([
    "",
    "0",
    "email",
    "username",
    "userId",
    "authorId",
    "authorizationUrl",
    "carId",
    "vin",
    "mileage",
    "reqId",
    "msg",
    "url",
    "method",
    "statusCode",
    "tokenCount",
    "promptTokenCount",
    "cookieConsent",
    "otpEnabled",
    "sessionCount",
    "signatureAlgorithm",
    "cacheKey",
    "idempotencyKey",
    "passenger",
    "passengerCount",
    "cacheBypass",
    "csrfEnabled",
    "assertionCount",
    "verifierId",
    "headers",
  ])("leaves %j visible", (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});

describe("redactUrls", () => {
  it.each([
    ["postgres://apex:pw@db:5432/apex", `postgres://${REDACTED}@db:5432/apex`],
    ["redis://:pw@cache:6379", `redis://${REDACTED}@cache:6379`],
    ["https://user@example.com/", `https://${REDACTED}@example.com/`],
    [
      "a password with an @: postgres://apex:p@ss@db/apex",
      `a password with an @: postgres://${REDACTED}@db/apex`,
    ],
    [
      "a password with a ?: postgres://apex:p?ss@db/apex",
      `a password with a ?: postgres://${REDACTED}@db/apex`,
    ],
    ["(postgres://apex:pw@db)", `(postgres://${REDACTED}@db)`],
    // Several URLs joined without spaces, as in lists of Redis or PostgreSQL servers.
    [
      "redis://:pw1@a:6379,redis://:pw2@b:6379",
      `redis://${REDACTED}@a:6379,redis://${REDACTED}@b:6379`,
    ],
    [
      "postgres://u:p1@a/db,postgres://u:p2@b/db",
      `postgres://${REDACTED}@a/db,postgres://${REDACTED}@b/db`,
    ],
    ["redis://a:6379,redis://:pw2@b:6379", `redis://a:6379,redis://${REDACTED}@b:6379`],
    ["https://x/a|https://u:p@y", `https://x/a|https://${REDACTED}@y`],
    [
      "nodes=[redis://:pw1@a;redis://:pw2@b]",
      `nodes=[redis://${REDACTED}@a;redis://${REDACTED}@b]`,
    ],
  ])("hides the user information in %j", (text, expected) => {
    expect(redactUrls(text)).toBe(expected);
  });

  it.each([
    ["/reset?token=abc", `/reset?${REDACTED}`],
    ["/cb#access_token=abc", `/cb#${REDACTED}`],
    ["/login?next=/garage#top", `/login?${REDACTED}`],
    [
      "https://example.com/garage/1?ref=driver@example.com",
      `https://example.com/garage/1?${REDACTED}`,
    ],
    ["https://example.com?a=1", `https://example.com?${REDACTED}`],
    [
      "https://minio:9000/photos/car.jpg?X-Amz-Credential=key&X-Amz-Signature=sig",
      `https://minio:9000/photos/car.jpg?${REDACTED}`,
    ],
    ["postgres://apex:pw@db/apex?sslmode=require", `postgres://${REDACTED}@db/apex?${REDACTED}`],
    ['in "/login?token=abc" (GET)', `in "/login?${REDACTED}" (GET)`],
    ["Route GET:/nope?token=abc not found", `Route GET:/nope?${REDACTED} not found`],
    ["two: /a?x=1 and /b?y=2", `two: /a?${REDACTED} and /b?${REDACTED}`],
  ])("hides the query string and fragment in %j", (text, expected) => {
    expect(redactUrls(text)).toBe(expected);
  });

  it.each([
    "",
    "car saved",
    "Server listening at http://127.0.0.1:4000",
    "sent mail to driver@example.com",
    "mailto:driver@example.com",
    "ready?",
    "is /health up?",
    "fixed in #12",
    "a/b",
    "/health",
    "/health?",
  ])("leaves %j alone", (text) => {
    expect(redactUrls(text)).toBe(text);
  });

  it("gives the same result when applied twice", () => {
    const once = redactUrls("postgres://apex:pw@db/apex?sslmode=require and /reset?token=abc");

    expect(redactUrls(once)).toBe(once);
  });

  // A regular expression that backtracks would take minutes on these inputs (quadratic time), and
  // so would a scan that searches back to the start of the text for each of a million URLs; the
  // token scan takes milliseconds, well inside the test timeout. Each input contains "@", "?" or
  // "#", so none of them skips the scan.
  it.each([
    ["a scheme-like run with no @ or ?", `a://${"x.".repeat(200_000)}#`],
    ["many schemes", `${"a://".repeat(1_000_000)}@`],
    ["many @ signs", `x://${"@".repeat(200_000)}/`],
    ["many slashes and question marks", "/?".repeat(200_000)],
  ])("handles %s in linear time", (_name, text) => {
    expect(redactUrls(text).length).toBeLessThanOrEqual(text.length + REDACTED.length);
  });

  it("hides the user information of many URLs in one run of text in linear time", () => {
    const text = "a://u:p@h,".repeat(100_000);

    expect(redactUrls(text)).toBe(`a://${REDACTED}@h,`.repeat(100_000));
  });
});
