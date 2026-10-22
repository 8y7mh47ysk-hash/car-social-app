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

/**
 * A run of text without whitespace, which may hold a URL or a path. Only whitespace ends it:
 * quotes, backticks and angle brackets can stand unencoded inside a URL (an apostrophe in a
 * password or a query string, a backtick in a query string that a browser sends), and Node.js
 * accepts all of them in a request target, which Fastify quotes in some of its messages.
 */
const URL_LIKE_TOKEN = /\S+/g;

/**
 * Hides the parts of URLs that can carry secrets, wherever URLs appear in a piece of text:
 *
 * - the user information of every URL with "://": "postgres://apex:pw@db/apex" becomes
 *   "postgres://[Redacted]@db/apex". Everything up to the last "@" before the first "/" counts,
 *   so a password that contains "@" is hidden too, and one that contains "?" or "#" hides all
 *   that follows the "://" (see hideUrlParts). URLs joined without spaces, as in
 *   "redis://:pw@a:6379,redis://:pw@b:6379", each get their own;
 * - everything after the first "?" or "#" of a URL or path, up to the next whitespace:
 *   "/reset?token=abc" becomes "/reset?[Redacted]". That covers reset links, signed storage URLs
 *   ("X-Amz-Signature=...") and OAuth redirects ("#access_token=..."). Whatever follows a URL
 *   without a space, such as the closing quote in '"/reset?token=abc",', is hidden with it.
 *
 * A "?" or "#" counts only if a "/" comes before it in its run of text without whitespace, so
 * questions ("ready?") and numbers ("#12") are left alone. A URL that contains a raw space, which
 * URLs never do once encoded, ends at the space: whatever follows it stays visible. The work is
 * linear in the length of the text, whatever it contains.
 */
export function redactUrls(text: string): string {
  if (!text.includes("@") && !text.includes("?") && !text.includes("#")) {
    return text;
  }
  return text.replace(URL_LIKE_TOKEN, (token) => {
    // In free text, a "?" or "#" starts a query string or fragment only after a "/". One before
    // the first "/" ('why?"/reset?token=abc"') stays, and the search goes on after it.
    const slash = token.indexOf("/");
    const queryOffset = slash === -1 ? -1 : token.slice(slash).search(/[?#]/);
    return hideUrlParts(token, queryOffset === -1 ? -1 : slash + queryOffset);
  });
}

/**
 * Hides the user information of `url` and everything after its first "?" or "#", treating the
 * whole text as one URL: unlike redactUrls, it needs no "/" before the "?" (a request target can
 * be "*?token=abc") and nothing in the URL ends it early. For request URLs, which the client
 * chooses: "/reset?name=d'arcy&token=abc" becomes "/reset?[Redacted]".
 */
export function redactUrl(url: string): string {
  return hideUrlParts(url, url.search(/[?#]/));
}

/**
 * Hides the user information of every URL with "://" in a run of text, and everything after the
 * "?" or "#" at `queryStart` (-1 for none; a "?" with nothing after it, as in "/health?", hides
 * nothing). User information is everything up to the last "@" before the next "/". When that "@"
 * comes after `queryStart`, as in "https://example.com?email=a@b.com&token=abc", it may end a
 * password or belong to the query string, so everything after the "://" is hidden. A URL's
 * authority runs from its "://" to the next "/", or to the end of the text, so authorities never
 * overlap and each character is looked at a fixed number of times.
 */
function hideUrlParts(token: string, queryStart: number): string {
  const hiddenFrom =
    queryStart === -1 || queryStart === token.length - 1 ? token.length : queryStart + 1;
  let result = "";
  let copied = 0;
  let schemeEnd = token.indexOf("://");
  while (schemeEnd !== -1 && schemeEnd + 3 < hiddenFrom) {
    const authorityStart = schemeEnd + 3;
    const slash = token.indexOf("/", authorityStart);
    const authorityEnd = slash === -1 ? token.length : slash;
    const at = token.slice(authorityStart, authorityEnd).lastIndexOf("@");
    if (at !== -1) {
      if (authorityStart + at >= hiddenFrom) {
        return `${result}${token.slice(copied, authorityStart)}${REDACTED}`;
      }
      result += `${token.slice(copied, authorityStart)}${REDACTED}`;
      copied = authorityStart + at;
    }
    // A "://" contains a "/", so the next one starts no earlier than just before this slash, as
    // in "...:6379,redis://", and there is none if this authority runs to the end.
    schemeEnd = slash === -1 ? -1 : token.indexOf("://", slash - 1);
  }
  return hiddenFrom === token.length
    ? `${result}${token.slice(copied)}`
    : `${result}${token.slice(copied, hiddenFrom)}${REDACTED}`;
}
