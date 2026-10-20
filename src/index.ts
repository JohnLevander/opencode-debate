import { Agent, Plugin } from "@opencode/plugin";
import { z } from "zod";
import { defaults, loadConfig, type DebateConfig } from "./config.ts";
import { runDebate } from "./core/debate.ts";
import type { Turn } from "./core/types.ts";
import { DEBATER_SYSTEM, TOOL_DESCRIPTION } from "./prompts.ts";
import { OpenCodeAdapter, AGENT_ID, MODEL_NAMES, NO_TOOLS, retryAfterMs } from "./adapters/opencode.ts";
import { DebateLog } from "./log.ts";
import { renderResult } from "./render.ts";

export const debateArgs = z.object({
  question: z.string().trim().min(1).max(100_000), context: z.string().max(300_000).optional(),
  max_rounds: z.number().int().min(1).max(8).optional(), first: z.enum(["glm", "deepseek", "random"]).default("random"),
  include_transcript: z.boolean().default(false),
}).strict();
export type DebateArgs = z.input<typeof debateArgs>;
type Execution = { sessionID: string; agent: string; signal: AbortSignal; progress: (data: Record<string, unknown>) => Promise<void> };

export async function executeDebate(ctx: Plugin.Context, input: DebateArgs, execution: Execution, owned: Set<string>, retryHints = new Map<string, number>()): Promise<string> {
  const args = debateArgs.parse(input);
  let config: DebateConfig = defaults(); let configurationError: unknown;
  try { config = await loadConfig(ctx.location.directory, ctx.location.project.directory); }
  catch (error) { configurationError = error; }
  const journal = new DebateLog(config.logDir, args.question, { question: args.question, context: args.context, config, args,
    opencodeVersion: ctx.app.version, parentSessionID: execution.sessionID, turns: [], pointHistory: [], sessions: [] });
  try { await journal.initialize(); }
  catch (error) { return `## Debate result: error\n### Final answer\nNo answer was gathered.\n### Details\nCannot create the required debate log at ${journal.path}: ${error instanceof Error ? error.message : String(error)}`; }
  const adapter = new OpenCodeAdapter(ctx, config, execution.sessionID, journal.slug, owned, retryHints);
  const turns: Turn[] = []; const pendingWrites: Promise<unknown>[] = [];
  const progress = (message: string) => {
    const task = Promise.race([execution.progress({ title: "Debate", description: message, status: message }), new Promise<void>(resolve => { const timer = setTimeout(resolve, 1000); timer.unref(); })]).catch(() => {});
    pendingWrites.push(task);
  };
  const save = (patch: Record<string, unknown>) => { const task = journal.update(patch); task.catch(() => {}); pendingWrites.push(task); };
  const cancel = () => { void adapter.cancelAll(); };
  execution.signal.addEventListener("abort", cancel, { once: true });
  if (execution.signal.aborted) cancel();
  try {
    const result = await runDebate({
      question: args.question, context: args.context, maxRounds: args.max_rounds ?? config.defaultMaxRounds,
      first: args.first, callTimeoutMs: config.callTimeoutMs, totalTimeoutMs: config.totalTimeoutMs, signal: execution.signal,
      callModel: async (...params) => {
        if (configurationError) throw configurationError;
        if (execution.agent === AGENT_ID) throw new Error("A debater cannot invoke the debate tool");
        if (config.backend !== "opencode") throw new Error("The openai-compatible fallback is scheduled for Phase 4 and is not implemented yet. Select backend: opencode.");
        return adapter.callModel(...params);
      },
      onEvent(event) {
        if (event.type === "start") {
          adapter.setAssignment(event.assignment); save({ assignment: event.assignment });
          progress(`Debate starting: ${MODEL_NAMES[event.assignment.proposer]} (proposer), ${MODEL_NAMES[event.assignment.challenger]} (challenger)`);
        } else if (event.type === "turn_start") {
          const t = event.turn;
          progress(t.round === 0 ? `${MODEL_NAMES[t.debater]} (proposer) preparing the opening answer.` : `Round ${t.round}/${args.max_rounds ?? config.defaultMaxRounds}: ${MODEL_NAMES[t.debater]} (${t.role}) ${t.role === "challenger" ? "reviewing the revision" : "responding and revising"}.`);
        } else if (event.type === "retry") progress(`${event.turnID}: retrying after ${event.reason}${event.delayMs ? ` in ${event.delayMs} ms` : ""}.`);
      },
      onTurn(turn) { turns.push(turn); save({ turns, sessions: adapter.sessions }); },
    });
    if (result.status === "cancelled" || result.status === "error") await adapter.cancelAll();
    await Promise.allSettled(pendingWrites);
    const output = renderResult(result, config, journal.path, adapter.sessions, args.include_transcript);
    await journal.update({ ...result, config, args, sessions: adapter.sessions, diagnostics: adapter.diagnostics, interruptions: adapter.interruptions, finalResult: output });
    progress(`Debate ended: ${result.status}. ${result.rounds} Challenger round(s). Log: ${journal.path}`);
    return output;
  } catch (error) {
    await adapter.cancelAll();
    const reason = error instanceof Error ? error.message : String(error);
    await journal.update({ status: execution.signal.aborted ? "cancelled" : "error", reason, turns, sessions: adapter.sessions, interruptions: adapter.interruptions }).catch(() => {});
    return `## Debate result: ${execution.signal.aborted ? "cancelled" : "error"}\n### Final answer\nSee the partial transcript in the log.\n### Details\nReason: ${reason}\nLog: ${journal.path}`;
  } finally { execution.signal.removeEventListener("abort", cancel); adapter.release(); }
}

export default Plugin.define({
  id: "opencode-debate",
  async setup(ctx) {
    const owned = new Set<string>();
    const retryHints = new Map<string, number>();
    const existing = (await ctx.agent.list()).data.find(a => a.id === AGENT_ID);
    if (existing && existing.description !== "Internal structured debate participant") throw new Error("Agent 'debater' already exists with another definition; rename it before enabling opencode-debate.");
    await ctx.agent.transform(editor => editor.update(AGENT_ID, agent => {
      agent.name = Agent.Name.make("debater"); agent.description = "Internal structured debate participant";
      agent.mode = "subagent"; agent.hidden = true; agent.system = DEBATER_SYSTEM;
      agent.permissions = [...NO_TOOLS]; delete agent.steps;
    }));
    await ctx.session.hook("context", event => {
      if (event.agent !== AGENT_ID && !owned.has(event.sessionID)) return;
      for (const tool of Object.keys(event.tools)) delete event.tools[tool];
      // Preserve the agent prompt and any additional context assembled by OpenCode.
      // Tool isolation does not require replacing the system-message array.
    });
    await ctx.session.hook("http.response", event => {
      if (event.agent !== AGENT_ID && !owned.has(event.sessionID)) return;
      if (event.response.status === 429) {
        const delay = retryAfterMs(event.response.headers.get("Retry-After"));
        if (delay !== undefined) retryHints.set(event.sessionID, delay);
      }
    });
    // Let the deterministic engine own provider retry/backoff instead of stacking retries.
    await ctx.session.hook("retry", event => {
      if (event.agent === AGENT_ID || owned.has(event.sessionID)) event.decision = { retry: false };
    });
    await ctx.tool.transform(editor => editor.add({
      name: "debate", description: TOOL_DESCRIPTION, input: debateArgs, options: { codemode: false },
      async execute(input, context) { return { content: await executeDebate(ctx, input, context, owned, retryHints) }; },
    }));
  },
});
