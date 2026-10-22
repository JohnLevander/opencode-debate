import type { DebateErrorCode } from "../core/types.ts";

// Outage wording is used only to pick a retry classification; it is never surfaced or logged.
// No fixed subject list: any unavailable/overloaded wording counts where wording is authoritative
// (statusless envelopes and HTTP 429). Concrete statuses outrank wording everywhere else.
const OUTAGE_MESSAGE = /\b(?:temporarily\s+|currently\s+)?(?:unavailable|overloaded)\b/i;
const OUTAGE_TYPE = /(?:^|[._-])(?:(?:endpoint|service|upstream)[_-]unavailable|server[_-]error|overloaded(?:[_-]error)?|gateway[_-]?timeout|bad[_-]?gateway)$/;
const RATE_LIMIT_TYPE = /rate.?limit|too[_ -]?many[_ -]?requests/i;
// Deliberate-list transient statuses: standard server/gateway failures, Anthropic 529 overload,
// and Cloudflare 520-524 origin failures. Other 5xx (501/505/507...) are permanent by design.
// Shared with the Retry-After hint capture in index.ts so the lists cannot drift apart.
export const TRANSIENT_STATUSES: readonly number[] = [408, 500, 502, 503, 504, 529, 520, 521, 522, 523, 524];

export function providerFailureCode(status?: number, type = "", message = ""): DebateErrorCode {
  // Credential/configuration errors must not be retried as outages, even with a misleading envelope.
  if (status === 401 || status === 403 || /auth|permission|invalid[_-]?(?:api[_-]?)?(?:key|model|request)/i.test(type)) return "transport";
  // 408, the transient gateway/server statuses, and Anthropic-style 529 stay retryable regardless of wording.
  if (TRANSIENT_STATUSES.includes(status ?? -1)) return "provider_unavailable";
  // The native gateway reports capacity failures as provider.rate-limit + "Endpoint is unavailable"
  // with status 429 (see docs/INSTALL.md): only for 429 does outage wording outrank the status.
  if (status === 429) return OUTAGE_MESSAGE.test(message) || OUTAGE_TYPE.test(type) ? "provider_unavailable" : "rate_limit";
  // Any other concrete 4xx is permanent; outage or rate-limit wording cannot make 400/404 retryable.
  if (status !== undefined && status >= 400 && status < 500) return "transport";
  // Other concrete statuses stay permanent even if the envelope says rate-limit.
  if (status !== undefined) return "transport";
  return OUTAGE_MESSAGE.test(message) || OUTAGE_TYPE.test(type) ? "provider_unavailable"
    : RATE_LIMIT_TYPE.test(type) || RATE_LIMIT_TYPE.test(message) ? "rate_limit" : "transport";
}

export function retryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value) return;
  value = value.trim(); // tolerate obs-fold/whitespace padding around the field value
  // RFC 9110 allows only plain decimal seconds (or an HTTP-date); reject hex, exponents,
  // signs, and whitespace, whose numeric coercion would invent huge or bogus delays.
  if (/^\d+$/.test(value)) { const milliseconds = Number(value) * 1000; return Number.isFinite(milliseconds) ? milliseconds : undefined; }
  // Only HTTP-dates (which always name a month or weekday) may use the date fallback;
  // V8's Date.parse accepts numeric junk like "+3" as a valid date.
  if (/[a-z]/i.test(value)) {
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
}
