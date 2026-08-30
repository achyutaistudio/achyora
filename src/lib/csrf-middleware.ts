/**
 * Same-origin CSRF guard for server functions.
 *
 * Deliberately hand-rolled instead of importing `createCsrfMiddleware` from
 * @tanstack/react-start: importing that factory from `src/start.ts` makes the
 * bundler split the framework's server core into two chunks that import each
 * other, and the resulting circular ESM evaluation throws
 * "TypeError: createCsrfMiddleware is not a function" on every request in the
 * Cloudflare Workers production build.
 *
 * The checks below mirror the framework default
 * (Sec-Fetch-Site -> Origin -> Referer, all required to be same-origin).
 */
import { createMiddleware } from "@tanstack/react-start";

function isSameOriginReferer(referer: string, origin: string): boolean {
  if (referer === origin) return true;
  if (!referer.startsWith(origin)) return false;
  if (referer.length === origin.length) return true;
  const next = referer.charCodeAt(origin.length);
  // "/", "?" or "#"
  return next === 47 || next === 63 || next === 35;
}

function isAllowed(request: Request): boolean {
  const secFetchSite = request.headers.get("Sec-Fetch-Site");
  if (secFetchSite !== null) return secFetchSite === "same-origin";

  const origin = request.headers.get("Origin");
  if (origin !== null) return origin === new URL(request.url).origin;

  const referer = request.headers.get("Referer");
  if (referer === null) return true;
  return isSameOriginReferer(referer, new URL(request.url).origin);
}

export const csrfMiddleware = createMiddleware().server(async (ctx) => {
  const { handlerType, request } = ctx as typeof ctx & {
    handlerType?: string;
    request: Request;
  };

  if (handlerType === "serverFn" && !isAllowed(request)) {
    return new Response("Forbidden", { status: 403 });
  }
  return ctx.next();
});
