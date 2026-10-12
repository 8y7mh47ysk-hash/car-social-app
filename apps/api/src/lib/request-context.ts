import { AsyncLocalStorage } from "node:async_hooks";

import type { onRequestHookHandler } from "fastify";

import { REQUEST_ID_HEADER } from "./request-id.ts";

/** What code running for a request can learn about it without being handed the request. */
export interface RequestContext {
  readonly requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * The context of the request whose code is running now, or undefined outside request handling
 * (startup, shutdown, timers started before any request).
 */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Runs `fn` inside `context`: `getRequestContext()` returns it in `fn` and in everything `fn`
 * starts, including awaited promises, timers and event callbacks registered there.
 */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/**
 * Must be the app's first onRequest hook. It sends the request ID back in the x-request-id
 * response header, then runs the rest of the request (later hooks, body parsing, validation, the
 * handler, onSend and onResponse hooks, and everything they await) inside the request's context.
 * Fastify carries the context across body parsing itself: its content-type parser finishes in an
 * AsyncResource created when parsing starts. logging.test.ts checks this over a real connection.
 *
 * Hooks that Fastify starts from socket events (onTimeout, onRequestAbort) run outside the
 * context, so they should log with `request.log`.
 */
export const enterRequestContext: onRequestHookHandler = (request, reply, done) => {
  // reply.header() returns the reply, which is thenable; there is nothing to await.
  void reply.header(REQUEST_ID_HEADER, request.id);
  runWithRequestContext({ requestId: request.id }, done);
};
