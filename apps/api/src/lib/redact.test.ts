import { describe, expect, it } from "vitest";

import { REDACTED, isSensitiveKey, redactUrl, redactUrls } from "./redact.ts";

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
    // A "?" or "#" before the "@" may start a query string instead, so everything after "://" goes.
    [
      "a password with a ?: postgres://apex:p?ss@db/apex",
      `a password with a ?: postgres://${REDACTED}`,
    ],
    [
      "a password with a #: postgres://apex:p#ss@db/apex",
      `a password with a #: postgres://${REDACTED}`,
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
    // Characters that can stand unencoded in a password, before or after its "@".
    ["postgres://apex:it's-a-secret@db:5432/apex", `postgres://${REDACTED}@db:5432/apex`],
    ['postgres://apex:a"b<c>d`e@db/apex', `postgres://${REDACTED}@db/apex`],
    [
      "connecting to 'postgres://apex:pw@db/apex'",
      `connecting to 'postgres://${REDACTED}@db/apex'`,
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
    // An "@" in the query string of a URL without a path might end a password instead.
    ["https://example.com?invite=a@b.com&token=abc", `https://${REDACTED}`],
    ["see https://example.com#email=a@b.com&access_token=abc", `see https://${REDACTED}`],
    [
      "https://minio:9000/photos/car.jpg?X-Amz-Credential=key&X-Amz-Signature=sig",
      `https://minio:9000/photos/car.jpg?${REDACTED}`,
    ],
    ["postgres://apex:pw@db/apex?sslmode=require", `postgres://${REDACTED}@db/apex?${REDACTED}`],
    ["Route GET:/nope?token=abc not found", `Route GET:/nope?${REDACTED} not found`],
    ["two: /a?x=1 and /b?y=2", `two: /a?${REDACTED} and /b?${REDACTED}`],
    // Only whitespace ends a URL: what follows it without a space is hidden with the query.
    ['in "/login?token=abc" (GET)', `in "/login?${REDACTED} (GET)`],
    ["['/a?x=1','/b?token=abc']", `['/a?${REDACTED}`],
    // A "?" or "#" with no "/" before it does not end the search for one that has.
    ['{"q":"why?","next":"/reset?token=abc"}', `{"q":"why?","next":"/reset?${REDACTED}`],
    ["#12:/reset?token=abc", `#12:/reset?${REDACTED}`],
    // Characters that a query string can hold unencoded, all before the secret.
    ["/reset?name=d'arcy&token=abc", `/reset?${REDACTED}`],
    ["/search?q=a`b&token=abc", `/search?${REDACTED}`],
    ['/search?q="a"&token=abc', `/search?${REDACTED}`],
    ["/search?q=<a>&token=abc", `/search?${REDACTED}`],
    // Fastify's warning for a reply sent twice quotes the raw request URL.
    [
      'Reply was already sent, did you forget to "return reply" in the "/cars?q="&token=abc" (GET) route?',
      `Reply was already sent, did you forget to "return reply" in the "/cars?${REDACTED} (GET) route?`,
    ],
    // A "*" counts like a "/": Node.js also accepts request targets that start with "*".
    [
      'Reply was already sent, did you forget to "return reply" in "*?token=abc" (OPTIONS)?',
      `Reply was already sent, did you forget to "return reply" in "*?${REDACTED} (OPTIONS)?`,
    ],
    ["*x?token=abc", `*x?${REDACTED}`],
    ['"**#access_token=abc"', `"**#${REDACTED}`],
    ["why?*?token=abc", `why?*?${REDACTED}`],
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
    "it's ready?",
    "a/b",
    "/health",
    "/health?",
    "*",
    "5 * 3 = 15?",
    "rated 4*?",
    // With no "/" or "*" before it, a "?" is not taken to start a query string (see redactUrls).
    "example.com?key=abc",
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
    ["many stars and a question mark", `${"*".repeat(400_000)}?#`],
  ])("handles %s in linear time", (_name, text) => {
    expect(redactUrls(text).length).toBeLessThanOrEqual(text.length + REDACTED.length);
  });

  it("hides the user information of many URLs in one run of text in linear time", () => {
    const text = "a://u:p@h,".repeat(100_000);

    expect(redactUrls(text)).toBe(`a://${REDACTED}@h,`.repeat(100_000));
  });
});

// Request targets, as Node.js accepts them from a client.
describe("redactUrl", () => {
  it.each([
    ["/health", "/health"],
    ["/health?", "/health?"],
    ["/cars/7?sort=name", `/cars/7?${REDACTED}`],
    ["/cb#access_token=abc", `/cb#${REDACTED}`],
    ["/reset?name=d'arcy&token=abc", `/reset?${REDACTED}`],
    ["/search?q=a`b&token=abc", `/search?${REDACTED}`],
    ['/search?q="&token=abc', `/search?${REDACTED}`],
    ["/search?q=<>&token=abc", `/search?${REDACTED}`],
    // Node.js also accepts targets that start with "*".
    ["*?token=abc", `*?${REDACTED}`],
    ["*x?token=abc", `*x?${REDACTED}`],
    // Unlike redactUrls, it needs no "/" or "*" before the "?".
    ["?token=abc", `?${REDACTED}`],
    ["http://u:p@example.com?token=abc", `http://${REDACTED}@example.com?${REDACTED}`],
    ["http://apex:it's-a-secret@example.com/", `http://${REDACTED}@example.com/`],
    ["http://example.com?email=a@b&token=abc", `http://${REDACTED}`],
  ])("logs %j as %j", (url, expected) => {
    expect(redactUrl(url)).toBe(expected);
  });
});

// The rules of both functions, checked on random runs of text made of URL characters with a
// secret somewhere in each. Each test seeds its own generator, so every run of a test, alone or
// with the others, checks the same texts.
describe("URL redaction on random text", () => {
  const pieces = ["a", "b", "/", "*", ":", "?", "#", "@", "://", "'", '"', "=", "&", ",", ".", "%"];
  const ROUNDS = 20_000;

  /**
   * `ROUNDS` texts, each a random run of pieces, the word "secret" and another random run, with
   * the secret's offset. The generator is a linear congruential one in exact 32-bit integer
   * arithmetic, of which only the high bits are used: in floating point the product loses its
   * low bits, and the low bits of such a generator repeat quickly (an earlier version drew only
   * 2,339 different texts in 20,000 rounds).
   */
  function randomTexts(seed: number): { text: string; secretAt: number }[] {
    let state = seed;
    const random = (n: number): number => {
      state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
      return (state >>> 16) % n;
    };
    const randomText = (): string =>
      Array.from({ length: random(10) }, () => pieces[random(pieces.length)]).join("");
    return Array.from({ length: ROUNDS }, () => {
      const before = randomText();
      return { text: `${before}secret${randomText()}`, secretAt: before.length };
    });
  }

  it("draws mostly different texts", () => {
    for (const seed of [7, 8]) {
      const texts = randomTexts(seed).map(({ text }) => text);

      expect(new Set(texts).size).toBeGreaterThan(ROUNDS * 0.95);
    }
  });

  /** Whether the secret at `at` is in the user information of a URL with "://". */
  function inUserInfo(text: string, at: number): boolean {
    const nextSlash = text.indexOf("/", at);
    const authorityEnd = nextSlash === -1 ? text.length : nextSlash;
    for (let scheme = text.indexOf("://"); scheme !== -1 && scheme < at;) {
      if (!text.slice(scheme + 3, at).includes("/")) {
        return text.slice(at, authorityEnd).includes("@");
      }
      scheme = text.indexOf("://", scheme + 1);
    }
    return false;
  }

  /** Where a query string starts in free text, by redactUrls's rule; -1 for nowhere. */
  function queryStartInText(text: string): number {
    for (let index = 0; index < text.length; index += 1) {
      if ("?#".includes(text.charAt(index)) && /[*/]/.test(text.slice(0, index))) {
        return index;
      }
    }
    return -1;
  }

  it("never shows a secret in user information, or after a ? or # that a / or * comes before", () => {
    const shown: string[] = [];
    for (const { text, secretAt } of randomTexts(7)) {
      const query = queryStartInText(text);
      const afterQuery = query !== -1 && query < secretAt;
      if ((afterQuery || inUserInfo(text, secretAt)) && redactUrls(text).includes("secret")) {
        shown.push(text);
      }
    }

    expect(shown).toEqual([]);
  });

  it("never shows a secret in a request URL's user information, query string or fragment", () => {
    const shown: string[] = [];
    for (const { text, secretAt } of randomTexts(8)) {
      const query = text.search(/[?#]/);
      const afterQuery = query !== -1 && query < secretAt;
      if ((afterQuery || inUserInfo(text, secretAt)) && redactUrl(text).includes("secret")) {
        shown.push(text);
      }
    }

    expect(shown).toEqual([]);
  });
});
