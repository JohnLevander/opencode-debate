import type { Plugin } from "@opencode/plugin";
import type { SessionStructuredError } from "@opencode/client";
import { abortable, abortReason } from "../core/debate.ts";
import { DebateError, type Debater, type DebateResult } from "../core/types.ts";
import type { DebateConfig } from "../config.ts";
export type OpenCodeClient = Pick<Plugin.Context, "session" | "model">;
export const AGENT_ID = "debater";
export const MODEL_NAMES: Record<Debater, string> = { glm: "GLM", deepseek: "DeepSeek" };
export const NO_TOOLS = [{ action: "*", resource: "*", effect: "deny" as const }];
export interface SessionDetail { debater: Debater; id: string; title: string; model: DebateConfig["models"][Debater]; role: "proposer" | "challenger" }
export function retryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value) return;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - now);
}
export function providerError(error: SessionStructuredError, retryAfter?: number): DebateError {
  return new DebateError(error.status === 429 || /rate.?limit|too many requests/i.test(error.type) ? "rate_limit" : "transport", `${error.type}: ${error.message}`, retryAfter);
}
export class OpenCodeAdapter {
  readonly sessions: SessionDetail[] = [];
  readonly diagnostics: string[] = [];
  readonly interruptions: { sessionID: string; requestedAt: number; acknowledgedAt?: number; interrupted?: boolean; error?: string }[] = [];
  private initialization?: Promise<void>;
  private assignment?: DebateResult["assignment"];
  private closed = false;
  private pending = new Map<Debater, Promise<void>>();
  constructor(private ctx: OpenCodeClient, private config: DebateConfig, private parentID: string, private slug: string, private owned: Set<string>, private retryHints = new Map<string, number>()) {}
  setAssignment(value: DebateResult["assignment"]) { this.assignment = value; }
  private async initialize(): Promise<void> {
    if (!this.assignment) throw new Error("Missing role assignment");
    const parent = await this.ctx.session.get({ sessionID: this.parentID });
    const { data: models } = await this.ctx.model.list({ location: { directory: parent.location.directory } });
    for (const debater of ["glm", "deepseek"] as const) {
      const configured = this.config.models[debater];
      const available = models.find(m => m.providerID === configured.providerID && m.id === configured.modelID && m.enabled && m.status !== "deprecated");
      if (!available) throw new DebateError("transport", `Model ${configured.providerID}/${configured.modelID} is unavailable. Configure backend: "openai-compatible" in .opencode/debate.config.json for the fallback (Phase 4).`);
      if (configured.variant && !available.variants.some(v => v.id === configured.variant)) throw new DebateError("transport", `Variant ${configured.variant} is unavailable for ${configured.modelID}`);
    }
    for (const debater of ["glm", "deepseek"] as const) {
      if (this.closed) throw new DebateError("cancelled", "Debate adapter closed before child creation");
      const selected = this.config.models[debater];
      const role = this.assignment.proposer === debater ? "proposer" : "challenger";
      const title = `debate: ${this.slug} | ${MODEL_NAMES[debater]} (${role})`;
      const child = await this.ctx.session.create({ parentID: this.parentID, title, agent: AGENT_ID,
        model: { providerID: selected.providerID, id: selected.modelID, ...(selected.variant ? { variant: selected.variant } : {}) },
        permissions: NO_TOOLS, metadata: { opencodeDebate: true, debater, role },
      });
      this.owned.add(child.id); this.sessions.push({ debater, id: child.id, title, role, model: selected });
      if (this.closed) { await this.interrupt(child.id); this.owned.delete(child.id); throw new DebateError("cancelled", "Child arrived after debate ended and was interrupted"); }
    }
  }
  private async interrupt(sessionID: string): Promise<void> {
    // Do not await plugin-local wait() here: its request signal is ignored in 2.0.32.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observation: OpenCodeAdapter["interruptions"][number] = { sessionID, requestedAt: Date.now() };
    this.interruptions.push(observation);
    try {
      const acknowledgement = await Promise.race([this.ctx.session.interrupt({ sessionID, resume: false }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Interrupt acknowledgement timed out")), 3000); })]);
      observation.acknowledgedAt = Date.now(); observation.interrupted = acknowledgement.interrupted;
    } catch (error) {
      observation.error = error instanceof Error ? error.message : String(error);
      this.diagnostics.push(`${sessionID}: ${observation.error}`);
    }
    finally { clearTimeout(timer); }
  }
  async cancelAll(): Promise<void> {
    this.closed = true;
    await Promise.all(this.sessions.map(s => this.interrupt(s.id)));
  }
  callModel = async (debater: Debater, message: string, signal: AbortSignal): Promise<{ text: string; reasoning?: string }> => {
    if (signal.aborted) throw abortReason(signal);
    if (this.closed) throw new DebateError("cancelled", "Debate adapter is closed");
    let child: SessionDetail | undefined;
    const stop = () => {
      const current = child ?? this.sessions.find(s => s.debater === debater);
      if (current) void this.interrupt(current.id);
    };
    signal.addEventListener("abort", stop, { once: true });
    // Keep a barrier around the raw in-process operations as well as the caller's
    // abort race. A prompt that is admitted late must be stopped before retrying.
    const previous = this.pending.get(debater);
    const work = (async () => {
      const check = async () => {
        if (!signal.aborted) return;
        const current = child ?? this.sessions.find(s => s.debater === debater);
        if (current) await this.interrupt(current.id);
        throw abortReason(signal);
      };
      if (previous) await previous;
      await check();
      this.initialization ??= this.initialize();
      await this.initialization;
      child = this.sessions.find(s => s.debater === debater)!;
      await check();
      // A previous interrupt acknowledges before cleanup; wait for actual idle.
      await this.ctx.session.wait({ sessionID: child.id }); await check();
      const before = await this.ctx.session.context({ sessionID: child.id }); await check();
      this.retryHints.delete(child.id);
      const admitted = await this.ctx.session.prompt({ sessionID: child.id, text: message, delivery: "queue" }); await check();
      await this.ctx.session.wait({ sessionID: child.id }); await check();
      const [messages, state] = await Promise.all([this.ctx.session.context({ sessionID: child.id }), this.ctx.session.get({ sessionID: child.id })]);
      await check();
      const boundary = messages.findIndex(m => m.id === admitted.id && m.type === "user");
      if (boundary < 0) throw new DebateError("transport", "Admitted debate input was not found in child history");
      const fresh = messages.slice(boundary + 1);
      if (fresh.some(m => m.type === "user")) throw new DebateError("transport", "Unexpected user input in a debate child session");
      if (before.some(m => m.id === admitted.id)) throw new DebateError("transport", "Debate input ID was reused");
      const assistant = fresh.filter(m => m.type === "assistant").at(-1);
      const idle = fresh.filter(m => m.type === "idle").at(-1);
      if (assistant?.error) throw providerError(assistant.error, this.retryHints.get(child.id));
      if (idle?.error) throw providerError(idle.error, this.retryHints.get(child.id));
      if (state.outcome === "failed" || state.outcome === "interrupted") throw new DebateError("transport", `Child session ${state.outcome}`);
      if (!assistant || !assistant.time.completed || !assistant.finish || assistant.finish === "tool-calls" || assistant.finish === "length" || assistant.finish === "error" || assistant.finish === "content-filter") throw new DebateError("transport", "Child completed without a final, untruncated assistant answer");
      if (assistant.agent !== AGENT_ID || assistant.model.id !== child.model.modelID || assistant.model.providerID !== child.model.providerID || (assistant.model.variant ?? "default") !== (child.model.variant ?? "default")) throw new DebateError("transport", "Child agent or model selection changed during debate");
      const text = assistant.content.filter(p => p.type === "text").map(p => p.text).join("\n\n");
      const reasoning = assistant.content.filter(p => p.type === "reasoning").map(p => p.text).join("\n\n");
      if (!text.trim()) throw new DebateError("transport", "Child returned reasoning but no final text");
      if (signal.aborted) throw abortReason(signal);
      return { text, ...(reasoning ? { reasoning } : {}) };
    })();
    const barrier = work.then(() => {}, () => {});
    this.pending.set(debater, barrier);
    try { return await abortable(work, signal); }
    finally { signal.removeEventListener("abort", stop); }
  };
  release() { for (const s of this.sessions) this.owned.delete(s.id); }
}
