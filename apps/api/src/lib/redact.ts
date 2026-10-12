/** What a sensitive value is replaced with in log output. */
export const REDACTED = "[Redacted]";

/**
 * Keys whose values never reach the logs. A key is compared after lowercasing it and removing
 * everything except letters and digits, so "Set-Cookie", "set_cookie" and "setCookie" all become
 * "setcookie". A key is sensitive if it:
 *
 * - contains password, passwd, passphrase, secret, credential, apikey, privatekey,
 *   encryptionkey, signingkey, masterkey or recoverycode (newPassword, client_secret,
 *   credentials, x-api-key, recoveryCodes);
 * - ends in token, tokens, jwt, authorization, cookie, cookies, sessionid, otp or signature
 *   (refreshToken, x-csrf-token, proxy-authorization, set-cookie, sessionId, totp,
 *   stripe-signature). "tokens" is included so that a list of tokens is hidden too, which means
 *   counts of AI tokens must be logged under names such as promptTokenCount;
 * - is exactly auth (HTTP clients keep "user:password" there) or rawpacket (Node.js attaches the
 *   raw bytes of a malformed request, cookies included, to the parser error that Fastify logs
 *   at trace level).
 *
 * When you add a field that holds a secret, give it a name that matches, or add a pattern here
 * with a test.
 */
const SENSITIVE_KEY =
  /password|passwd|passphrase|secret|credential|apikey|privatekey|encryptionkey|signingkey|masterkey|recoverycode|(?:tokens?|jwt|authorization|cookies?|sessionid|otp|signature)$|^(?:auth|rawpacket)$/;

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
