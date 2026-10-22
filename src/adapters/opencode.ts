import type { Plugin } from "@opencode/plugin";
import type { SessionStructuredError } from "@opencode/client";
import { abortable, abortReason } from "../core/debate.ts";
import { DebateError, type Debater, type DebateResult } from "../core/types.ts";
import type { DebateConfig } from "../config.ts";
import { RestrictedRead, type RestrictedReads } from "../restricted-read.ts";
import type { DebateAdapter, SessionDetail, SessionInterruption } from "./types.ts";
import { providerFailureCode } from "./http.ts";
export type { SessionDetail } from "./types.ts";
export type OpenCodeClient = Pick<Plugin.Context, "session" | "model">;
export const AGENT_ID = "debater";
export const MODEL_NAMES: Record<Debater, string> = { glm: "GLM", deepseek: "DeepSeek" };
export const NO_TOOLS = [{ action: "*", resource: "*", effect: "deny" as const }];
/** SDK transport failures may retry; request/schema failures and programming errors may not. */
function requestError(error: unknown): DebateError {
  const record = error && typeof error === "object" ? error as { name?: unknown; _tag?: unknown; reason?: unknown; status?: unknown; statusCode?: unknown; code?: unknown; cause?: unknown; message?: unknown } : undefined;
  const cause = record?.cause && typeof record.cause === "object" ? record.cause as { status?: unknown; code?: unknown } : undefined;
  const status = [record?.status, record?.statusCode, cause?.status].find(value => typeof value === "number" && Number.isInteger(value));
  if (typeof status === "number") return new DebateError(providerFailureCode(status), `OpenCode server request failed (HTTP ${status}). Check the server connection and request configuration.`);
  // Declared SDK errors (UnauthorizedError, SessionNotFoundError, InvalidRequestError, ...)
  // describe a rejected request, not a broken connection. Never echo a remote error body.
  if (typeof record?._tag === "string") return new DebateError("transport", `OpenCode server rejected the request (${record._tag.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80)}). Check credentials, session, and request configuration.`);
  const sdkTransport = record?.name === "ClientError" && record.reason === "Transport";
  const networkCode = [record?.code, cause?.code].some(code => typeof code === "string" && /^(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN|UND_ERR_(?:CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT|SOCKET|DESTROYED|CLOSED))$/.test(code));
  const fetchFailure = error instanceof TypeError && /^(?:fetch failed|failed to fetch|network request failed|socket hang up)$/i.test(error.message);
  return sdkTransport || networkCode || fetchFailure
    ? new DebateError("provider_unavailable", "OpenCode server request failed. Check the OpenCode server connection.")
    : new DebateError("transport", "OpenCode request could not be completed. Check request configuration and plugin diagnostics.");
}
export function providerError(error: SessionStructuredError, retryAfter?: number, readCompatibility = false): DebateError {
  const nativeMessage = `${error.type}: ${error.message}`;
  const message = /free tier can only be used from within OpenCode/i.test(error.message)
    ? `${nativeMessage} This request already ran inside an OpenCode child session. OpenCode free models have a reported compatibility issue when read/shell tools are disabled; ${readCompatibility ? "restricted empty-file read compatibility mode was enabled, but the gateway still rejected the request." : "these debaters intentionally have all tools disabled."} This error alone does not establish that a paid provider or OpenRouter API key is needed. The debate remains blocked; changing tool permissions requires approval. Upstream: https://github.com/anomalyco/opencode/issues/51241`
    : nativeMessage;
  return new DebateError(providerFailureCode(error.status, error.type, error.message), message, retryAfter);
}
export class OpenCodeAdapter implements DebateAdapter {
  readonly sessions: SessionDetail[] = [];
  readonly diagnostics: string[] = [];
  readonly interruptions: SessionInterruption[] = [];
  private initialization?: Promise<void>;
  private assignment?: DebateResult["assignment"];
  private closed = false;
  private pending = new Map<Debater, Promise<void>>();
  constructor(private ctx: OpenCodeClient, private config: DebateConfig, private parentID: string, private slug: string, private owned: Set<string>, private retryHints = new Map<string, number>(), private restrictedReads: RestrictedReads = new Map()) {}
  setAssignment(value: DebateResult["assignment"]) { this.assignment = value; }
  private async initialize(): Promise<void> {
    if (!this.assignment) throw new DebateError("transport", "Missing role assignment");
    const parent = await this.ctx.session.get({ sessionID: this.parentID });
    const { data: models } = await this.ctx.model.list({ location: { directory: parent.location.directory } });
    for (const debater of ["glm", "deepseek"] as const) {
      const configured = this.config.models[debater];
      const available = models.find(m => m.providerID === configured.providerID && m.id === configured.modelID && m.enabled && m.status !== "deprecated");
      if (!available) throw new DebateError("transport", `Model ${configured.providerID}/${configured.modelID} is unavailable. Configure backend: "openai-compatible" in .opencode/debate.config.json for the fallback.`);
      if (configured.variant && !available.variants.some(v => v.id === configured.variant)) throw new DebateError("transport", `Variant ${configured.variant} is unavailable for ${configured.modelID}`);
    }
    let readPolicy: RestrictedRead | undefined;
    if (this.config.readCompatibility) {
      try { readPolicy = await RestrictedRead.create(parent.location.directory); }
      catch (error) {
        throw new DebateError("transport", `Restricted-read compatibility check failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    for (const debater of ["glm", "deepseek"] as const) {
      // Re-entry after a partial failure creates only the missing children, never duplicates.
      if (this.sessions.some(s => s.debater === debater)) continue;
      if (this.closed) throw new DebateError("cancelled", "Debate adapter closed before child creation");
      const selected = this.config.models[debater];
      const role = this.assignment.proposer === debater ? "proposer" : "challenger";
      const title = `debate: ${this.slug} | ${MODEL_NAMES[debater]} (${role})`;
      const child = await this.ctx.session.create({ parentID: this.parentID, title, agent: AGENT_ID,
        model: { providerID: selected.providerID, id: selected.modelID, ...(selected.variant ? { variant: selected.variant } : {}) },
        permissions: readPolicy?.permissions ?? NO_TOOLS, metadata: { opencodeDebate: true, debater, role },
      });
      this.owned.add(child.id);
      if (readPolicy) this.restrictedReads.set(child.id, readPolicy);
      this.sessions.push({ debater, id: child.id, title, role, model: selected, ...(readPolicy ? { readCompatibilityFile: readPolicy.file } : {}) });
      if (this.closed) { await this.interrupt(child.id); this.owned.delete(child.id); this.restrictedReads.delete(child.id); throw new DebateError("cancelled", "Child arrived after debate ended and was interrupted"); }
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
    await Promise.all(this.sessions.map(s => { this.retryHints.delete(s.id); return this.interrupt(s.id); }));
  }
  callModel = async (debater: Debater, message: string, outerSignal: AbortSignal): Promise<{ text: string; reasoning?: string }> => {
    const toolViolation = new AbortController();
    const signal = AbortSignal.any([outerSignal, toolViolation.signal]);
    if (signal.aborted) throw abortReason(signal);
    if (this.closed) throw new DebateError("cancelled", "Debate adapter is closed");
    let child: SessionDetail | undefined;
    let readPolicy: RestrictedRead | undefined;
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
      // A transient initialization failure must not poison later attempts: clear the cached
      // rejection so the next call re-runs idempotent child creation for the missing debater.
      this.initialization ??= this.initialize().catch(error => { this.initialization = undefined; throw error; });
      await this.initialization;
      child = this.sessions.find(s => s.debater === debater)!;
      await check();
      // A previous interrupt acknowledges before cleanup; wait for actual idle.
      await this.ctx.session.wait({ sessionID: child.id }); await check();
      const before = await this.ctx.session.context({ sessionID: child.id }); await check();
      this.retryHints.delete(child.id);
      readPolicy = this.restrictedReads.get(child.id);
      readPolicy?.beginTurn(child.id, toolViolation);
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
      if (assistant?.error) throw providerError(assistant.error, this.retryHints.get(child.id), this.config.readCompatibility);
      if (idle?.error) throw providerError(idle.error, this.retryHints.get(child.id), this.config.readCompatibility);
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
    try {
      return await abortable(work, signal);
    } catch (error) {
      if (signal.aborted) throw abortReason(signal);
      if (error instanceof DebateError) throw error;
      throw requestError(error);
    } finally {
      signal.removeEventListener("abort", stop);
      if (child) readPolicy?.endTurn(child.id, toolViolation);
    }
  };
  release() { for (const s of this.sessions) { this.owned.delete(s.id); this.restrictedReads.delete(s.id); this.retryHints.delete(s.id); } }
}
