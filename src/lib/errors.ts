export const ERROR_CODES = [
  "AUTH_REQUIRED",
  "INVALID_INPUT",
  "INSUFFICIENT_CREDITS",
  "GUEST_LIMIT_REACHED",
  "AI_SERVICE_NOT_CONFIGURED",
  "AI_SERVICE_ERROR",
  "FILE_TOO_LARGE",
  "UNAUTHORIZED",
  "NOT_FOUND",
  "RATE_LIMITED",
  "PAYMENT_FAILED",
  "PAYMENTS_NOT_CONFIGURED",
  "UNSUPPORTED_FEATURE",
  "UNKNOWN",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export type AchyoraFailure = {
  ok: false;
  code: ErrorCode;
  message: string;
  details?: Json;
};

export type AchyoraSuccess<T> = { ok: true } & T;
export type AchyoraResult<T> = AchyoraSuccess<T> | AchyoraFailure;

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  AUTH_REQUIRED: "Sign in to continue.",
  INVALID_INPUT: "That input isn't valid. Please review and try again.",
  INSUFFICIENT_CREDITS: "You've used your free credits for today.",
  GUEST_LIMIT_REACHED: "You've reached the free guest limit.",
  AI_SERVICE_NOT_CONFIGURED:
    "The AI service is not configured on this deployment. Add provider credentials to enable it.",
  AI_SERVICE_ERROR: "The AI service could not complete this request.",
  FILE_TOO_LARGE: "That file is too large.",
  UNAUTHORIZED: "You don't have access to this resource.",
  NOT_FOUND: "We couldn't find that.",
  RATE_LIMITED: "Too many requests. Please slow down and try again.",
  PAYMENT_FAILED: "The payment could not be completed.",
  PAYMENTS_NOT_CONFIGURED:
    "Payments are not configured on this deployment yet.",
  UNSUPPORTED_FEATURE: "This capability is not available on this deployment.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export function fail(
  code: ErrorCode,
  message?: string,
  details?: Json,
): AchyoraFailure {
  return {
    ok: false,
    code,
    message: message ?? DEFAULT_MESSAGES[code],
    ...(details ? { details } : {}),
  };
}

export function isFailure<T>(
  result: AchyoraResult<T>,
): result is AchyoraFailure {
  return result.ok === false;
}

export function messageForCode(code: ErrorCode): string {
  return DEFAULT_MESSAGES[code] ?? DEFAULT_MESSAGES.UNKNOWN;
}
