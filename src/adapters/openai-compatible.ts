import { z } from "zod";
import type { DebateConfig } from "../config.ts";
import { abortable, abortReason } from "../core/debate.ts";
import { DebateError, type DebateResult, type Debater } from "../core/types.ts";
import { DEBATER_SYSTEM } from "../prompts.ts";
import { providerFailureCode, retryAfterMs } from "./http.ts";
import type { DebateAdapter, SessionDetail, SessionInterruption } from "./types.ts";

type Message = { role: "system" | "user" | "assistant"; content: string };
// fetch with redirect: "error" rejects as a generic network TypeError; only its cause chain
// identifies the redirect, which is a permanent endpoint-configuration problem.
function redirectFailure(error: unknown): boolean {
  for (let cause: unknown = error; cause instanceof Error && (cause as Error).cause !== cause; cause = (cause as { cause?: unknown }).cause) {
    if (/unexpected redirect/i.test(cause.message)) return true;
  }
  return false;
}
// Generous headroom over the largest schema-valid reply (~8 MB of point notes); responses beyond
// it are endpoint misbehavior and must be rejected instead of buffered into memory.
const MAX_BODY_BYTES = 16 * 1024 * 1024;
/** Bounded body read: a declared or actual oversized body fails before unbounded buffering. */
async function readBounded(response: Response, maxBytes = MAX_BODY_BYTES, signal?: AbortSignal): Promise<string> {
  const declared = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw new DebateError("transport", `OpenAI-compatible endpoint declared an oversized response (> ${maxBytes} bytes)`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const decoder = new TextDecoder();
  let text = "", received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) throw new DebateError("transport", `OpenAI-compatible endpoint returned an oversized response (> ${maxBytes} bytes)`);
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    cancel();
    throw error;
  } finally { signal?.removeEventListener("abort", cancel); }
  return text;
}
function bodyRetryAfterMs(body: unknown): number | undefined {
  if (!body || typeof body !== "object") return;
  const envelope = body as { retry_after?: unknown; error?: { retry_after?: unknown } | null };
  const raw = envelope.retry_after ?? envelope.error?.retry_after;
  const seconds = typeof raw === "number" ? raw
    : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  const milliseconds = seconds * 1000;
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : undefined;
}
/** Retry hints are optional: bounded reads must never mask a known HTTP failure. */
async function errorBodyRetryAfterMs(response: Response, signal: AbortSignal): Promise<number | undefined> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 1000);
  const bounded = AbortSignal.any([signal, timeout.signal]);
  try {
    const text = await readBounded(response, 64 * 1024, bounded);
    return bounded.aborted ? undefined : bodyRetryAfterMs(JSON.parse(text));
  } catch { return undefined; }
  finally { clearTimeout(timer); }
}
const completionSchema = z.object({
  choices: z.array(z.object({
    finish_reason: z.literal("stop"),
    message: z.object({
      role: z.literal("assistant"), content: z.string().refine(text => text.trim().length > 0),
      reasoning: z.string().nullish(), reasoning_content: z.string().nullish(),
      reasoning_details: z.array(z.unknown()).nullish(),
      tool_calls: z.array(z.unknown()).max(0).nullish(), function_call: z.null().optional(),
      refusal: z.null().optional(),
    }),
  })).length(1),
});

/** Non-streaming, text-only chat completions. The core owns every retry/deadline. */
export class OpenAICompatibleAdapter implements DebateAdapter {
  readonly sessions: SessionDetail[] = [];
  readonly diagnostics: string[] = [];
  readonly interruptions: SessionInterruption[] = [];
  private history: Record<Debater, Message[]> = { glm: [], deepseek: [] };
  private active = new Map<Debater, AbortController>();
  private closed = false;
  constructor(private config: DebateConfig, private env: NodeJS.ProcessEnv = process.env, private request: typeof fetch = fetch) {}
  setAssignment(_value: DebateResult["assignment"]): void {}
  async cancelAll(): Promise<void> {
    this.closed = true;
    for (const controller of this.active.values()) controller.abort(new DebateError("cancelled", "Debate cancelled"));
  }
  release(): void { void this.cancelAll(); this.history = { glm: [], deepseek: [] }; }

  callModel = async (debater: Debater, message: string, signal: AbortSignal): Promise<{ text: string; reasoning?: string }> => {
    if (signal.aborted) throw abortReason(signal);
    if (this.closed) throw new DebateError("cancelled", "Debate adapter is closed");
    if (this.active.has(debater)) throw new DebateError("transport", "A fallback request is already running for this debater");
    const settings = this.config.openaiCompatible;
    const key = this.env[settings.apiKeyEnv]?.trim();
    if (!key) throw new DebateError("transport", `Missing API key: set ${settings.apiKeyEnv} in the OpenCode server environment and restart it.`);
    // Control characters would make fetch reject the Authorization header mid-flight; fail up front.
    if (/[\x00-\x1F\x7F]/.test(key)) throw new DebateError("transport", `API key in ${settings.apiKeyEnv} contains control characters; fix the OpenCode server environment variable.`);
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    this.active.set(debater, controller);
    const messages: Message[] = [{ role: "system", content: DEBATER_SYSTEM }, ...this.history[debater], { role: "user", content: message }];
    const work = (async () => {
      try {
        const response = await this.request(`${settings.baseURL.replace(/\/+$/, "")}/chat/completions`, {
          method: "POST", redirect: "error", signal: controller.signal,
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: settings.models[debater], messages, stream: false }),
        });
        // Never include server bodies in error strings: they can echo credentials/headers.
        if (!response.ok) {
          const code = providerFailureCode(response.status);
          let retryAfter = retryAfterMs(response.headers.get("Retry-After"));
          if (retryAfter === undefined && (code === "rate_limit" || code === "provider_unavailable")) {
            retryAfter = await errorBodyRetryAfterMs(response, controller.signal);
          } else {
            // Headers and permanent statuses need no body; cleanup must not delay classification.
            void response.body?.cancel().catch(() => {});
          }
          throw new DebateError(code,
            `OpenAI-compatible request failed (HTTP ${response.status}). ${code === "provider_unavailable" ? "Provider temporarily unavailable." : code === "rate_limit" ? "Provider rate limit reached." : "Check endpoint, credentials, and model configuration."}`,
            retryAfter);
        }
        let body: unknown;
        try { body = JSON.parse(await readBounded(response)); }
        catch (error) {
          if (controller.signal.aborted) throw abortReason(controller.signal);
          // A complete but unparsable body is a permanent endpoint defect; a stream that failed
          // mid-read (connection dropped after HTTP 200) is a transient network failure.
          if (error instanceof DebateError) throw error;
          if (error instanceof SyntaxError) throw new DebateError("transport", "OpenAI-compatible endpoint returned invalid JSON");
          throw new DebateError("provider_unavailable", "OpenAI-compatible response body was interrupted. Check endpoint connectivity.",
            retryAfterMs(response.headers.get("Retry-After")));
        }
        if (controller.signal.aborted) throw abortReason(controller.signal);
        // Some compatible providers report an error in an HTTP 200 envelope; older ones use a bare string.
        if (body && typeof body === "object" && "error" in body && body.error != null) {
          const raw = body.error;
          const error = (typeof raw === "string" ? { message: raw } : raw) as { code?: unknown; type?: unknown; message?: unknown };
          const status = typeof error?.code === "number" ? error.code : typeof error?.code === "string" && /^\d{3}$/.test(error.code) ? Number(error.code) : undefined;
          const type = [error?.code, error?.type].filter(v => typeof v === "string").join(".");
          // The message is used only to pick a retry classification; it is never surfaced or logged.
          const message = typeof error?.message === "string" ? error.message : "";
          // Many compatible providers carry the retry delay in the error body instead of the header;
          // an explicit Retry-After header still wins.
          throw new DebateError(providerFailureCode(status, type, message), "OpenAI-compatible provider returned an error envelope",
            retryAfterMs(response.headers.get("Retry-After")) ?? bodyRetryAfterMs(body));
        }
        const parsed = completionSchema.safeParse(body);
        if (!parsed.success) throw new DebateError("transport", "OpenAI-compatible endpoint returned no complete, untruncated assistant text answer (tool calls and refusals are unsupported)");
        const reply = parsed.data.choices[0].message;
        const reasoning = reply.reasoning || reply.reasoning_content || (reply.reasoning_details?.length ? JSON.stringify(reply.reasoning_details) : undefined);
        if (controller.signal.aborted) throw abortReason(controller.signal);
        // Commit only completed requests. Failed/time-out requests cannot pollute retries.
        // Reasoning stays in the log, never in another model's messages (or replay history).
        this.history[debater].push({ role: "user", content: message }, { role: "assistant", content: reply.content });
        return { text: reply.content, ...(reasoning ? { reasoning } : {}) };
      } catch (error) {
        if (controller.signal.aborted) throw abortReason(controller.signal);
        if (error instanceof DebateError) throw error;
        if (redirectFailure(error)) throw new DebateError("transport", "OpenAI-compatible endpoint redirected the request; set baseURL to the final endpoint URL.");
        throw new DebateError("provider_unavailable", "OpenAI-compatible network request failed. Check endpoint connectivity.");
      }
    })();
    try { return await abortable(work, controller.signal); }
    finally {
      signal.removeEventListener("abort", abort);
      if (this.active.get(debater) === controller) this.active.delete(debater);
    }
  };
}
