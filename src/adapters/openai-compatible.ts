import { z } from "zod";
import type { DebateConfig } from "../config.ts";
import { abortable, abortReason } from "../core/debate.ts";
import { DebateError, type DebateResult, type Debater } from "../core/types.ts";
import { DEBATER_SYSTEM } from "../prompts.ts";
import { retryAfterMs } from "./http.ts";
import type { DebateAdapter, SessionDetail, SessionInterruption } from "./types.ts";

type Message = { role: "system" | "user" | "assistant"; content: string };
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
          await response.body?.cancel();
          throw new DebateError(response.status === 429 ? "rate_limit" : "transport",
            `OpenAI-compatible request failed (HTTP ${response.status}). Check endpoint, credentials, and model configuration.`,
            response.status === 429 ? retryAfterMs(response.headers.get("Retry-After")) : undefined);
        }
        let body: unknown;
        try { body = await response.json(); }
        catch { throw new DebateError("transport", "OpenAI-compatible endpoint returned invalid JSON"); }
        if (controller.signal.aborted) throw abortReason(controller.signal);
        // Some compatible providers report an error in an HTTP 200 envelope.
        if (body && typeof body === "object" && "error" in body && body.error != null) {
          const error = body.error as { code?: unknown; type?: unknown };
          const limited = error?.code === 429 || [error?.code, error?.type].some(v => typeof v === "string" && /^(429|rate[_-]?limit(?:[_-]exceeded)?|too_many_requests)$/i.test(v));
          throw new DebateError(limited ? "rate_limit" : "transport", "OpenAI-compatible provider returned an error envelope",
            limited ? retryAfterMs(response.headers.get("Retry-After")) : undefined);
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
        throw new DebateError("transport", "OpenAI-compatible network request failed. Check endpoint connectivity.");
      }
    })();
    try { return await abortable(work, controller.signal); }
    finally {
      signal.removeEventListener("abort", abort);
      if (this.active.get(debater) === controller) this.active.delete(debater);
    }
  };
}
