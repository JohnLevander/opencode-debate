import { Agent, Plugin } from "@opencode/plugin";
import { z } from "zod";
import { defaults, loadConfig, type DebateConfig } from "./config.ts";
import { runDebate } from "./core/debate.ts";
import type { IndependentCheck, Turn } from "./core/types.ts";
import { DEBATER_SYSTEM, TOOL_DESCRIPTION } from "./prompts.ts";
import { OpenCodeAdapter, AGENT_ID, MODEL_NAMES, NO_TOOLS } from "./adapters/opencode.ts";
import { retryAfterMs, TRANSIENT_STATUSES } from "./adapters/http.ts";
import { OpenAICompatibleAdapter } from "./adapters/openai-compatible.ts";
import type { DebateAdapter } from "./adapters/types.ts";
import { DebateLog } from "./log.ts";
import { registerToolIsolation, type RestrictedReads } from "./restricted-read.ts";
import { renderResult, VERIFICATION_NOTICE } from "./render.ts";
import { originalResultInfo, resultWithOriginal, withoutOriginalAttachments } from "./result.ts";
import { escapeInvalidUnicode } from "./core/unicode.ts";
import { commandVerifier } from "./verifier.ts";

export const debateArgs = z.object({
  question: z.string().trim().min(1).max(100_000), context: z.string().max(300_000).optional(),
  min_rounds: z.number().int().min(1).max(8).optional().describe("Minimum turns per side before convergence or stalemate may stop the debate; defaults to 1. An explicit max_rounds must be at least this large; an omitted one is raised to it."),
  max_rounds: z.number().int().min(1).max(8).optional(), first: z.enum(["glm", "deepseek", "random"]).default("random"),
  include_transcript: z.boolean().default(false),
}).strict();
export type DebateArgs = z.input<typeof debateArgs>;
type Execution = { sessionID: string; agent: string; signal: AbortSignal; progress: (data: Record<string, unknown>) => Promise<void> };

/** Shared plugin-lifetime state every debate needs; required so a call site cannot silently drop wiring. */
export interface DebateShared { owned: Set<string>; retryHints: Map<string, number>; restrictedReads: RestrictedReads }
export async function executeDebate(ctx: Plugin.Context, input: DebateArgs, execution: Execution, shared: DebateShared): Promise<string> {
  const { owned, retryHints, restrictedReads } = shared;
  const args = debateArgs.parse(input);
  let config: DebateConfig = defaults(); let configurationError: unknown;
  try { config = await loadConfig(ctx.location.directory, ctx.location.project.directory); }
  catch (error) { configurationError = error; }
  // An omitted max_rounds rises to min_rounds so a requested minimum is never rejected by the configured default.
  const maxRounds = args.max_rounds ?? Math.max(config.defaultMaxRounds, args.min_rounds ?? 1);
  // A failed configuration load must not be journaled as if the defaults had been used.
  const configErrorText = configurationError === undefined ? undefined : configurationError instanceof Error ? configurationError.message : String(configurationError);
  const journal = new DebateLog(config.logDir, args.question, { question: args.question, context: args.context,
    ...(configurationError === undefined ? { config } : { configError: configErrorText }), args,
    opencodeVersion: ctx.app.version, parentSessionID: execution.sessionID, limits: { minRounds: args.min_rounds ?? 1, maxRounds }, validationFailures: [], retryEvents: [], stopChecks: [], turns: [], pointHistory: [], sessions: [] });
  try { await journal.initialize(); }
  catch (error) { return escapeInvalidUnicode(`## Debate result: error\n${VERIFICATION_NOTICE}\n### Partial answer (debate incomplete)\nNo answer was gathered.\n### Details\nCannot create the required debate log at ${journal.path}: ${error instanceof Error ? error.message : String(error)}`); }
  const adapter: DebateAdapter = config.backend === "opencode"
    ? new OpenCodeAdapter(ctx, config, execution.sessionID, journal.slug, owned, retryHints, restrictedReads)
    : new OpenAICompatibleAdapter(config);
  const validationFailures: object[] = []; const retryEvents: object[] = []; const stopChecks: object[] = [];
  const checks: IndependentCheck[] = [];
  const turns: Turn[] = []; const pendingWrites: Promise<unknown>[] = [];
  const progress = (message: string) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>(resolve => { timer = setTimeout(resolve, 1000); timer.unref(); });
    let update: Promise<void>;
    try { update = Promise.resolve(execution.progress({ title: "Debate", description: message, status: message })); }
    catch { update = Promise.resolve(); } // a throwing or non-promise host callback must not break the tool
    const task = Promise.race([update.then(() => {}, () => {}).finally(() => clearTimeout(timer)), timeout]);
    pendingWrites.push(task);
  };
  const save = (patch: Record<string, unknown>) => { const task = journal.update(patch); task.catch(() => {}); pendingWrites.push(task); };
  const cancel = () => { void adapter.cancelAll(); };
  execution.signal.addEventListener("abort", cancel, { once: true });
  if (execution.signal.aborted) cancel();
  try {
    const result = await runDebate({
      question: args.question, context: args.context, maxRounds, minRounds: args.min_rounds,
      first: args.first, callTimeoutMs: config.callTimeoutMs, totalTimeoutMs: config.totalTimeoutMs, signal: execution.signal,
      verifier: config.verifier ? commandVerifier(config.verifier, ctx.location.directory) : undefined,
      callModel: async (...params) => {
        if (configurationError) throw configurationError;
        if (execution.agent === AGENT_ID) throw new Error("A debater cannot invoke the debate tool");
        return adapter.callModel(...params);
      },
      onEvent(event) {
        if (event.type === "start") {
          adapter.setAssignment(event.assignment); save({ assignment: event.assignment });
          progress(`Debate starting: ${MODEL_NAMES[event.assignment.proposer]} (proposer), ${MODEL_NAMES[event.assignment.challenger]} (challenger)`);
        } else if (event.type === "turn_start") {
          const t = event.turn;
          progress(t.round === 0 ? `${MODEL_NAMES[t.debater]} (proposer) preparing the opening answer.` : `Round ${t.round}/${maxRounds}: ${MODEL_NAMES[t.debater]} (${t.role}) ${t.role === "challenger" ? "reviewing the revision" : "responding and revising"}.`);
        } else if (event.type === "validation_failure") {
          validationFailures.push(event); save({ validationFailures });
          progress(`${event.turnID}: invalid reply (${event.reason}); ${event.repair ? "requesting one repair" : "stopping after failed repair"}.`);
        } else if (event.type === "independent_check") {
          checks.push(event.check); save({ independentChecks: checks });
          progress(`${event.check.turnID}: independent checks ${event.check.status} (${event.check.checksRun} checks).`);
        } else if (event.type === "stop_check") { stopChecks.push(event.check); save({ stopChecks });
        } else if (event.type === "retry") {
          retryEvents.push({ ...event, at: Date.now() }); save({ retryEvents });
          progress(`${event.turnID}: retrying after ${event.reason}${event.delayMs ? ` in ${event.delayMs} ms` : ""}.`);
        }
      },
      onTurn(turn) { turns.push(turn); save({ turns, sessions: adapter.sessions }); },
    });
    if (result.status === "cancelled" || result.status === "error") await adapter.cancelAll();
    await Promise.allSettled(pendingWrites);
    let output = renderResult(result, config, journal.path, adapter.sessions, args.include_transcript);
    const checkpoint = () => journal.update({ ...result, ...(configurationError === undefined ? { config } : { config: undefined, configError: configErrorText }),
      args, sessions: adapter.sessions, diagnostics: adapter.diagnostics, interruptions: adapter.interruptions, finalResult: output, originalResult: originalResultInfo(output) });
    // The debate already finished: a failed final checkpoint must not replace its result with a generic error.
    // Retry once so a transient failure still leaves a log matching the returned original.
    try { await checkpoint(); }
    catch {
      try { await checkpoint(); }
      catch (error) {
        output = escapeInvalidUnicode(`${output}\n\n### Log warning\nThe final debate log could not be written: ${error instanceof Error ? error.message : String(error)}. This result is the only complete copy; ${journal.path} holds at most an earlier checkpoint.`);
      }
    }
    progress(`Debate ended: ${result.status}. ${result.rounds} Challenger round(s). Log: ${journal.path}`);
    return output;
  } catch (error) {
    await adapter.cancelAll();
    const reason = error instanceof Error ? error.message : String(error);
    const status = execution.signal.aborted ? "cancelled" : "error";
    const output = escapeInvalidUnicode(`## Debate result: ${status}\n${VERIFICATION_NOTICE}\n### Partial answer (debate incomplete)\nSee the partial transcript in the log.\n### Details\nReason: ${reason}\nLog: ${journal.path}`);
    await journal.update({ status, reason, verification: "not_independently_verified", independentChecks: checks, turns, sessions: adapter.sessions, interruptions: adapter.interruptions, finalResult: output, originalResult: originalResultInfo(output) }).catch(() => {});
    return output;
  } finally { execution.signal.removeEventListener("abort", cancel); adapter.release(); }
}

export default Plugin.define({
  id: "opencode-debate",
  async setup(ctx) {
    const owned = new Set<string>();
    const restrictedReads: RestrictedReads = new Map();
    const retryHints = new Map<string, number>();
    const existing = (await ctx.agent.list()).data.find(a => a.id === AGENT_ID);
    if (existing && existing.description !== "Internal structured debate participant") throw new Error("Agent 'debater' already exists with another definition; rename it before enabling opencode-debate.");
    await ctx.agent.transform(editor => editor.update(AGENT_ID, agent => {
      agent.name = Agent.Name.make("debater"); agent.description = "Internal structured debate participant";
      agent.mode = "subagent"; agent.hidden = true; agent.system = DEBATER_SYSTEM;
      agent.permissions = [...NO_TOOLS]; delete agent.steps;
    }));
    await registerToolIsolation(ctx, owned, restrictedReads);
    await ctx.session.hook("context", event => {
      event.messages = withoutOriginalAttachments(event.messages ?? []);
    });
    await ctx.session.hook("http.response", event => {
      if (event.agent !== AGENT_ID && !owned.has(event.sessionID)) return;
      if ([...TRANSIENT_STATUSES, 429].includes(event.response.status)) { // 429 hints cover genuine rate limits too
        const delay = retryAfterMs(event.response.headers.get("Retry-After"));
        if (delay !== undefined) retryHints.set(event.sessionID, delay);
      }
    });
    // Let the deterministic engine own provider retry/backoff instead of stacking retries.
    await ctx.session.hook("retry", event => {
      if (event.agent === AGENT_ID || owned.has(event.sessionID)) event.decision = { retry: false };
    });
    await ctx.tool.transform(editor => editor.add({
      name: "debate", description: TOOL_DESCRIPTION, input: debateArgs, options: { codemode: true, pinned: true },
      async execute(input, context) { return resultWithOriginal(await executeDebate(ctx, input, context, { owned, retryHints, restrictedReads })); },
    }));
  },
});
