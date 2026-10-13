/** What a sensitive value is replaced with in log output. */
export const REDACTED = "[Redacted]";

/**
 * Keys whose values never reach the logs. A key is compared after lowercasing it and removing
 * everything except letters and digits, so "Set-Cookie", "set_cookie" and "setCookie" all become
 * "setcookie". A key is sensitive if it:
 *
 * - contains password, passwd, passphrase, secret, credential, apikey, privatekey,
 *   encryptionkey, signingkey, masterkey, recoverycode or codeverifier (newPassword,
 *   client_secret, credentials, x-api-key, recoveryCodes, and code_verifier, the PKCE secret of
 *   an OAuth sign-in);
 * - ends in token, tokens, jwt, authorization, cookie, cookies, sessionid, otp, signature (with
 *   or without digits after it), assertion or csrf (refreshToken, x-csrf-token,
 *   proxy-authorization, set-cookie, sessionId, totp, stripe-signature, the x-hub-signature-256
 *   header of Meta's webhooks, the cf-access-jwt-assertion header that Cloudflare Access adds to
 *   every request it lets through, and _csrf). "tokens" is included so that a list of tokens is
 *   hidden too, which means counts of AI tokens must be logged under names such as
 *   promptTokenCount;
 * - is exactly auth (HTTP clients keep "user:password" there), pass or pwd (short names for a
 *   password), rawpacket (Node.js attaches the raw bytes of a malformed request, cookies
 *   included, to the parser error that Fastify logs at trace level) or rawheaders (Node.js's
 *   list of header names and values, where a value cannot be matched to its name).
 *
 * Header names come from other parties, so the patterns cover the ones the plan will receive.
 * When you add a field that holds a secret, give it a name that matches, or add a pattern here
 * with a test.
 */
const SENSITIVE_KEY =
  /password|passwd|passphrase|secret|credential|apikey|privatekey|encryptionkey|signingkey|masterkey|recoverycode|codeverifier|(?:tokens?|jwt|authorization|cookies?|sessionid|otp|signature\d*|assertion|csrf)$|^(?:auth|pass|pwd|rawpacket|rawheaders)$/;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key.toLowerCase().replaceAll(/[^a-z\d]/g, ""));
}

/** A run of text that may hold a URL or a path: no whitespace, quotes or angle brackets. */
const URL_LIKE_TOKEN = /[^\s"'`<>]+/g;

/**
 * Hides the parts of URLs that can carry secrets, wherever URLs appear in a piece of text:
 *
 * - the user information of a URL with "://": "postgres://apex:pw@db/apex" becomes
 *   "postgres://[Redacted]@db/apex". Everything up to the last "@" before the first "/" counts,
 *   so a password that contains "@", "?" or "#" is hidden too;
 * - everything after the first "?" or "#" of a URL or path, so query strings and fragments never
 *   reach the logs: "/reset?token=abc" becomes "/reset?[Redacted]". That covers reset links,
 *   signed storage URLs ("X-Amz-Signature=...") and OAuth redirects ("#access_token=...").
 *
 * A "?" or "#" counts only in a run of text (no spaces or quotes) that has a "/" before it, so
 * questions ("ready?") and numbers ("#12") are left alone. The work is linear in the length of
 * the text, whatever it contains.
 */
export function redactUrls(text: string): string {
  if (!text.includes("@") && !text.includes("?") && !text.includes("#")) {
    return text;
  }
  return text.replace(URL_LIKE_TOKEN, redactUrlToken);
}

function redactUrlToken(token: string): string {
  let result = token;

  const schemeEnd = token.indexOf("://");
  if (schemeEnd !== -1) {
    const authorityStart = schemeEnd + 3;
    const pathStart = token.indexOf("/", authorityStart);
    const at = token.lastIndexOf("@", pathStart === -1 ? token.length : pathStart);
    if (at >= authorityStart) {
      result = `${token.slice(0, authorityStart)}${REDACTED}${token.slice(at)}`;
    }
  }

  const queryStart = result.search(/[?#]/);
  if (
    queryStart !== -1 &&
    queryStart < result.length - 1 &&
    result.lastIndexOf("/", queryStart) !== -1
  ) {
    result = `${result.slice(0, queryStart + 1)}${REDACTED}`;
  }

  return result;
}
