import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import plugin, { executeDebate, debateArgs, type DebateShared } from "../src/index.ts";
import { DEBATER_SYSTEM, TOOL_DESCRIPTION, COMMAND_BODY, COMMAND_DESCRIPTION } from "../src/prompts.ts";
import { defaults, loadConfig } from "../src/config.ts";
import { DebateLog } from "../src/log.ts";
import { fakeClient } from "./helpers/fake.ts";
import { tempRoot } from "./helpers/temp.ts";
import type { Plugin } from "@opencode/plugin";
import { createHash } from "node:crypto";

async function directory() { return tempRoot("test-"); }
test("v2 tool registration preserves exact description and hides/isolates debater", async () => {
  const hooks: Record<string, Function> = {}; let agent: any = {}; let tool: any;
  const ctx = {
    agent: { list: async () => ({ data: [] }), transform: async (fn: Function) => fn({ update: (_id: string, update: Function) => update(agent) }) },
    session: { hook: async (name: string, fn: Function) => { const previous = hooks[name]; hooks[name] = previous ? async (...args: unknown[]) => { await previous(...args); await fn(...args); } : fn; } },
    tool: { hook: async (name: string, fn: Function) => { hooks[`tool.${name}`] = fn; }, transform: async (fn: Function) => fn({ add: (value: any) => { tool = value; } }) },
  } as unknown as Plugin.Context;
  await plugin.setup(ctx);
  assert.equal(tool.description, TOOL_DESCRIPTION); assert.equal(tool.name, "debate");
  assert.deepEqual(tool.options, { codemode: true, pinned: true });
  assert.equal(agent.hidden, true); assert.equal(agent.mode, "subagent"); assert.equal(agent.system, DEBATER_SYSTEM);
  assert.deepEqual(agent.permissions, [{ action: "*", resource: "*", effect: "deny" }]);
  const event = { agent: "debater", sessionID: "child", tools: { debate: {}, shell: {}, mcp_custom: {} }, system: [{ type: "text", text: "Host harness instructions" }] as { type: string; text: string }[] };
  await hooks.context(event); assert.deepEqual(event.tools, {}); assert.equal(event.system[0].text, "Host harness instructions"); assert.equal(event.system.length, 1);
  const parent = { ...event, agent: "build", tools: { shell: {} } }; await hooks.context(parent); assert.deepEqual(parent.tools, { shell: {} });
  const retry = { agent: "debater", decision: { retry: true } }; hooks.retry(retry); assert.deepEqual(retry.decision, { retry: false });
  assert.ok(debateArgs.safeParse({ question: "Question", max_rounds: 8 }).success);
  assert.ok(!debateArgs.safeParse({ question: "Question", max_rounds: 9 }).success);
  assert.ok(debateArgs.safeParse({ question: "Question", min_rounds: 3, max_rounds: 6 }).success);
  assert.ok(!debateArgs.safeParse({ question: "Question", min_rounds: 0 }).success);
});
test("generated command matches centralized template verbatim", async () => {
  assert.equal(await readFile("commands/debate.md", "utf8"), `---\ndescription: ${COMMAND_DESCRIPTION}\n---\n\n${COMMAND_BODY}\n`);
});
test("layered config merges models and env with validation", async () => {
  const root = await directory(); const project = path.join(root, "project"); const nested = path.join(project, "nested");
  await mkdir(path.join(root, "config/opencode"), { recursive: true }); await mkdir(path.join(project, ".opencode"), { recursive: true }); await mkdir(nested);
  await writeFile(path.join(root, "config/opencode/debate.config.json"), JSON.stringify({ defaultMaxRounds: 2, models: { glm: { variant: "low" } } }));
  await writeFile(path.join(project, ".opencode/debate.config.json"), JSON.stringify({ defaultMaxRounds: 3, callTimeoutMs: 123 }));
  const cfg = await loadConfig(nested, project, { XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: root, OPENCODE_DEBATE_MAX_ROUNDS: "5" });
  assert.equal(cfg.defaultMaxRounds, 5); assert.equal(cfg.callTimeoutMs, 123); assert.equal(cfg.models.glm.variant, "low"); assert.equal(cfg.models.glm.modelID, "glm-5.3-flash-free");
  await assert.rejects(loadConfig(nested, project, { XDG_CONFIG_HOME: path.join(root, "config"), OPENCODE_DEBATE_CALL_TIMEOUT_MS: "oops" }));
});
test("atomic log writes retain full content and private permissions", async () => {
  const root = await directory(); const log = new DebateLog(root, "../question unsafe?", { context: "background" });
  await log.initialize(); await Promise.all([log.update({ turns: [{ reasoning: "private reasoning" }] }), log.update({ status: "cancelled" })]);
  const contents = JSON.parse(await readFile(log.path, "utf8")); assert.equal(contents.status, "cancelled"); assert.equal(contents.turns[0].reasoning, "private reasoning");
  assert.equal((await stat(log.path)).mode & 0o777, 0o600); assert.equal((await readdir(root)).length, 1);
});
test("journal coalesces concurrent updates into a single disk write", async () => {
  const root = await directory(); const log = new DebateLog(root, "question", {});
  await log.initialize();
  const updates = Array.from({ length: 50 }, (_, i) => log.update({ counter: i }));
  await Promise.all(updates);
  assert.equal(log.writeCount, 2); // the initialize write plus one coalesced flush
  assert.equal(JSON.parse(await readFile(log.path, "utf8")).counter, 49);
  assert.equal((await readdir(root)).length, 1);
});
test("tool writes an error log when a model is unavailable", async t => {
  const root = await directory(); const previous = process.env.OPENCODE_DEBATE_LOG_DIR;
  process.env.OPENCODE_DEBATE_LOG_DIR = root; t.after(() => { if (previous === undefined) delete process.env.OPENCODE_DEBATE_LOG_DIR; else process.env.OPENCODE_DEBATE_LOG_DIR = previous; });
  const fake = fakeClient(); fake.raw.model.list = async () => ({ data: [] });
  const ctx = { ...fake.client, location: { directory: root, project: { directory: root } }, app: { version: "2.0.32" } } as unknown as Plugin.Context;
  const output = await executeDebate(ctx, { question: "test", first: "glm" }, { sessionID: "parent", agent: "build", signal: new AbortController().signal, progress: async () => {} }, { owned: new Set(), retryHints: new Map(), restrictedReads: new Map() });
  assert.match(output, /Debate result: error/);
  const log = JSON.parse(await readFile(path.join(root, (await readdir(root))[0]), "utf8"));
  assert.equal(log.status, "error"); assert.match(log.reason, /glm-5.3-flash-free.*unavailable/); assert.equal(log.finalResult, output); assert.equal(log.sessions.length, 0);
});

test("a configuration failure is journaled as configError without a fictional config", async t => {
  const root = await directory();
  const env: Record<string, string | undefined> = { XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: root };
  const previous = { config: process.env.XDG_CONFIG_HOME, data: process.env.XDG_DATA_HOME };
  process.env.XDG_CONFIG_HOME = env.XDG_CONFIG_HOME; process.env.XDG_DATA_HOME = env.XDG_DATA_HOME;
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete (process.env as any)[key]; else (process.env as any)[key] = value; } });
  await mkdir(path.join(root, ".opencode"), { recursive: true });
  await writeFile(path.join(root, ".opencode/debate.config.json"), JSON.stringify({ defaultMaxRounds: true }));
  const fake = fakeClient();
  const ctx = { ...fake.client, location: { directory: root, project: { directory: root } }, app: { version: "2.0.32" } } as unknown as Plugin.Context;
  const output = await executeDebate(ctx, { question: "test", first: "glm" }, { sessionID: "parent", agent: "build", signal: new AbortController().signal, progress: async () => {} }, { owned: new Set(), retryHints: new Map(), restrictedReads: new Map() });
  assert.match(output, /Debate result: error/);
  const logDir = path.join(root, "opencode-debate/debates");
  const log = JSON.parse(await readFile(path.join(logDir, (await readdir(logDir))[0]), "utf8"));
  assert.equal(log.status, "error"); assert.match(log.configError, /defaultMaxRounds/);
  assert.equal("config" in log, false); assert.equal(log.finalResult, output);
});

test("a synchronously throwing progress callback cannot break the tool", async () => {
  const root = await directory(); const previous = process.env.OPENCODE_DEBATE_LOG_DIR;
  process.env.OPENCODE_DEBATE_LOG_DIR = root;
  try {
    const fake = fakeClient();
    const original = fake.raw.session.prompt;
    fake.raw.session.prompt = async input => {
      const admitted = await original(input);
      const content = fake.messages.get(input.sessionID)!.at(-1).content;
      content[0].text = JSON.stringify({ answer: input.sessionID === "child-0" ? "A valid final answer" : null, points: [], agrees_with_current_answer: fake.prompts.length > 1, confidence: 0.9 });
      content.splice(1, 1);
      return admitted;
    };
    const ctx = { ...fake.client, location: { directory: root, project: { directory: root } }, app: { version: "2.0.32" } } as unknown as Plugin.Context;
    const output = await executeDebate(ctx, { question: "test", first: "glm" }, { sessionID: "parent", agent: "build", signal: new AbortController().signal,
      progress: (() => { throw new Error("host progress bug"); }) as unknown as () => Promise<void> }, { owned: new Set(), retryHints: new Map(), restrictedReads: new Map() });
    assert.match(output, /Debate result: converged/);
  } finally { if (previous === undefined) delete process.env.OPENCODE_DEBATE_LOG_DIR; else process.env.OPENCODE_DEBATE_LOG_DIR = previous; }
});

for (const scenario of ["converged", "cancelled", "timeout"] as const) {
  test(`tool integration writes complete ${scenario} logs with retained sessions`, async t => {
    const root = await directory();
    const oldLog = process.env.OPENCODE_DEBATE_LOG_DIR, oldTimeout = process.env.OPENCODE_DEBATE_CALL_TIMEOUT_MS;
    process.env.OPENCODE_DEBATE_LOG_DIR = root;
    if (scenario === "timeout") process.env.OPENCODE_DEBATE_CALL_TIMEOUT_MS = "10";
    t.after(() => {
      if (oldLog === undefined) delete process.env.OPENCODE_DEBATE_LOG_DIR; else process.env.OPENCODE_DEBATE_LOG_DIR = oldLog;
      if (oldTimeout === undefined) delete process.env.OPENCODE_DEBATE_CALL_TIMEOUT_MS; else process.env.OPENCODE_DEBATE_CALL_TIMEOUT_MS = oldTimeout;
    });
    const fake = fakeClient(); const controller = new AbortController();
    const original = fake.raw.session.prompt;
    fake.raw.session.prompt = async input => {
      const admitted = await original(input);
      const content = fake.messages.get(input.sessionID)!.at(-1).content;
      content[0].text = JSON.stringify({ answer: input.sessionID === "child-0" ? "A valid final answer" : null, points: [], agrees_with_current_answer: fake.prompts.length > 1, confidence: 0.9 });
      content.splice(1, 1);
      if (scenario === "cancelled" && fake.prompts.length > 1) controller.abort();
      return admitted;
    };
    if (scenario === "timeout") fake.change({ onWait: async () => { if (fake.prompts.length) await new Promise<void>(() => {}); } });
    const ctx = { ...fake.client, location: { directory: root, project: { directory: root } }, app: { version: "2.0.32" } } as unknown as Plugin.Context;
    const progress: string[] = [];
    const output = await executeDebate(ctx, { question: "test", first: "glm", include_transcript: true, min_rounds: scenario === "converged" ? 2 : 1 }, {
      sessionID: "parent", agent: "build", signal: controller.signal, progress: async data => { progress.push(String(data.description)); },
    }, { owned: new Set(), retryHints: new Map(), restrictedReads: new Map() });
    const expected = scenario === "timeout" ? "error" : scenario;
    assert.match(output, new RegExp(`Debate result: ${expected}`));
    const log = JSON.parse(await readFile(path.join(root, (await readdir(root))[0]), "utf8"));
    assert.equal(log.status, expected); assert.equal(log.sessions.length, 2); assert.equal(fake.created.length, 2);
    assert.equal(log.finalResult, output); assert.ok(progress.length >= 3);
    if (scenario === "converged") {
      assert.equal(log.rounds, 2); assert.equal(log.turns.length, 4); assert.equal(log.args.min_rounds, 2);
      assert.deepEqual(log.limits, { minRounds: 2, maxRounds: 4 });
      assert.deepEqual(log.stopChecks.map((c: any) => c.decision), ["continue", "converged"]);
      assert.equal(log.contributions.method, "retained-phrases-v1"); assert.match(output, /Contribution winner \(text-reuse estimate\)/);
      assert.equal(log.turns[0].reasoning, "secret reasoning"); assert.ok(!fake.prompts[1].text.includes("secret reasoning"));
      assert.match(output, /### Transcript/); assert.equal(log.answer, "A valid final answer");
    } else { assert.ok(fake.interrupts.includes("child-0")); assert.ok(fake.interrupts.includes("child-1")); assert.ok(log.interruptions.some((entry: any) => entry.sessionID === "child-0" && entry.acknowledgedAt)); assert.ok(log.interruptions.some((entry: any) => entry.sessionID === "child-1" && entry.acknowledgedAt)); }
  });
}


test("invalid Challenger statuses are logged twice and the partial result cannot imply agreement", async t => {
  const root = await directory(); const previous = process.env.OPENCODE_DEBATE_LOG_DIR;
  process.env.OPENCODE_DEBATE_LOG_DIR = root;
  t.after(() => { if (previous === undefined) delete process.env.OPENCODE_DEBATE_LOG_DIR; else process.env.OPENCODE_DEBATE_LOG_DIR = previous; });
  const fake = fakeClient(); const original = fake.raw.session.prompt;
  fake.raw.session.prompt = async input => {
    const admitted = await original(input);
    const content = fake.messages.get(input.sessionID)!.at(-1).content;
    content[0].text = JSON.stringify({ answer: fake.prompts.length === 1 ? "A valid retained opening answer for testing" : null,
      points: fake.prompts.length === 1 ? [] : [{ id: "C1", summary: "Clarification", status: "resolved", note: "Already accepted" }],
      agrees_with_current_answer: true, confidence: 0.8 });
    content.splice(1, 1); return admitted;
  };
  const ctx = { ...fake.client, location: { directory: root, project: { directory: root } }, app: { version: "2.0.32" } } as unknown as Plugin.Context;
  const output = await executeDebate(ctx, { question: "test", first: "glm", include_transcript: true }, { sessionID: "parent", agent: "build", signal: new AbortController().signal, progress: async () => {} }, { owned: new Set(), retryHints: new Map(), restrictedReads: new Map() });
  const log = JSON.parse(await readFile(path.join(root, (await readdir(root))[0]), "utf8"));
  assert.equal(log.status, "error"); assert.equal(log.validationFailures.length, 2);
  assert.deepEqual(log.validationFailures.map((e: any) => e.repair), [true, false]);
  assert.equal(log.turns[1].attempts.length, 2); assert.match(log.turns[1].attempts[0].text, /resolved/);
  assert.match(log.validationFailures[0].reason, /New challenger point must be open/);
  assert.equal(log.stopChecks.length, 0); assert.equal(log.contributions.winner, "undetermined");
  assert.equal(log.failure.code, "protocol"); assert.equal(log.failure.turnID, "C1");
  assert.equal(log.failure.validationFailures, 2);
  assert.match(output, /Validated challenger reviews: 0/); assert.match(output, /unvalidated reply/);
  assert.match(output, /Partial answer \(debate incomplete\)/); assert.match(output, /does not establish agreement/);
  assert.ok(!output.includes("### Final answer"));
});

function debating() {
  const fake = fakeClient();
  const original = fake.raw.session.prompt;
  fake.raw.session.prompt = async (input: any) => {
    const admitted = await original(input);
    const message = fake.messages.get(input.sessionID)!.at(-1);
    message.content[0].text = JSON.stringify({ answer: input.sessionID === "child-0" ? "A valid final answer" : null, points: [], agrees_with_current_answer: fake.prompts.length > 1, confidence: 0.9 });
    message.content.splice(1, 1);
    return admitted;
  };
  return fake;
}
const executionOf = (agent: string, progress: () => Promise<void> = async () => {}) =>
  ({ sessionID: "parent", agent, signal: new AbortController().signal, progress });
const shared = (): DebateShared => ({ owned: new Set(), retryHints: new Map(), restrictedReads: new Map() });
const ctxOf = (fake: ReturnType<typeof fakeClient>, root: string) =>
  ({ ...fake.client, location: { directory: root, project: { directory: root } }, app: { version: "2.0.32" } }) as unknown as Plugin.Context;
async function withLogDir<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await directory();
  const previous = process.env.OPENCODE_DEBATE_LOG_DIR, previousConfig = process.env.XDG_CONFIG_HOME;
  process.env.OPENCODE_DEBATE_LOG_DIR = root; process.env.XDG_CONFIG_HOME = path.join(root, "no-global-config");
  try { return await fn(root); }
  finally {
    if (previous === undefined) delete process.env.OPENCODE_DEBATE_LOG_DIR; else process.env.OPENCODE_DEBATE_LOG_DIR = previous;
    if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previousConfig;
  }
}

test("a debater agent cannot invoke the debate tool", async () => withLogDir(async root => {
  const fake = fakeClient();
  const output = await executeDebate(ctxOf(fake, root), { question: "test", first: "glm" }, executionOf("debater"), shared());
  assert.match(output, /Debate result: error/); assert.match(output, /A debater cannot invoke the debate tool/);
  assert.equal(fake.created.length, 0); assert.equal(fake.prompts.length, 0);
}));
test("the debater-invocation guard still journals the failure", async () => withLogDir(async root => {
  const fake = fakeClient();
  await executeDebate(ctxOf(fake, root), { question: "test", first: "glm" }, executionOf("debater"), shared());
  const log = JSON.parse(await readFile(path.join(root, (await readdir(root))[0]), "utf8"));
  assert.equal(log.status, "error"); assert.match(log.reason, /cannot invoke/); assert.equal(log.sessions.length, 0);
}));
test("a parent agent runs the identical setup to convergence", async () => withLogDir(async root => {
  const output = await executeDebate(ctxOf(debating(), root), { question: "test", first: "glm" }, executionOf("build"), shared());
  assert.match(output, /Debate result: converged/);
}));

for (const [name, poison] of [["__proto__", '{"__proto__": {"defaultMaxRounds": 9}}'], ["constructor", '{"constructor": {"prototype": {}}}'], ["nested model", '{"models": {"glm": {"prototype": 1}}}']] as const) {
  test(`configuration files cannot poison prototypes via ${name} keys`, async () => {
    const root = await directory(); const dir = path.join(root, ".opencode"); await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "debate.config.json"), poison);
    await assert.rejects(loadConfig(root, root, { XDG_CONFIG_HOME: path.join(root, "none") }), /Invalid configuration key/);
    assert.equal(({} as any).defaultMaxRounds, undefined);
  });
}

function hookHarness(root: string, fake = fakeClient()) {
  const hooks: Record<string, Function> = {}; let tool: any;
  const ctx = {
    ...fake.client,
    agent: { list: async () => ({ data: [] }), transform: async (fn: Function) => fn({ update: (_id: string, update: Function) => update({}) }) },
    session: { ...fake.raw.session, hook: async (name: string, fn: Function) => { const previous = hooks[name]; hooks[name] = previous ? async (...args: unknown[]) => { await previous(...args); await fn(...args); } : fn; } },
    tool: { hook: async (name: string, fn: Function) => { hooks[`tool.${name}`] = fn; }, transform: async (fn: Function) => fn({ add: (v: any) => { tool = v; } }) },
    location: { directory: root, project: { directory: root } }, app: { version: "2.0.32" },
  } as unknown as Plugin.Context;
  return { fake, hooks, ctx, tool: () => tool };
}
test("the http.response hook feeds captured Retry-After hints into native retries", { timeout: 15000 }, async () => withLogDir(async root => {
  const { fake, hooks, ctx, tool } = hookHarness(root);
  await plugin.setup(ctx);
  fake.change({
    assistantError: { type: "provider.rate-limit", message: "Quota exceeded", status: 429 }, outcome: "failed",
    onPrompt: () => { hooks["http.response"]({ agent: "debater", sessionID: "child-0", response: { status: 429, headers: new Headers({ "Retry-After": "2" }) } }); },
  });
  await tool().execute({ question: "test", first: "glm" }, { sessionID: "parent", agent: "build", signal: new AbortController().signal, progress: async () => {} });
  const log = JSON.parse(await readFile(path.join(root, (await readdir(root))[0]), "utf8"));
  assert.deepEqual(log.retryEvents.map((e: any) => e.delayMs), [2000, 2000]);
}));
test("the http.response hook ignores hints on permanent statuses", async () => withLogDir(async root => {
  const { fake, hooks, ctx, tool } = hookHarness(root);
  await plugin.setup(ctx);
  fake.change({
    assistantError: { type: "provider.error", message: "Model not found", status: 404 }, outcome: "failed",
    onPrompt: () => { hooks["http.response"]({ agent: "debater", sessionID: "child-0", response: { status: 404, headers: new Headers({ "Retry-After": "9" }) } }); },
  });
  await tool().execute({ question: "test", first: "glm" }, { sessionID: "parent", agent: "build", signal: new AbortController().signal, progress: async () => {} });
  const log = JSON.parse(await readFile(path.join(root, (await readdir(root))[0]), "utf8"));
  assert.equal(log.status, "error"); assert.deepEqual(log.retryEvents, []); assert.equal(log.turns[0].attempts.length, 1);
}));
test("the http.response hook ignores junk headers and unrelated sessions", { timeout: 15000 }, async () => withLogDir(async root => {
  const { fake, hooks, ctx, tool } = hookHarness(root);
  await plugin.setup(ctx);
  fake.change({
    assistantError: { type: "provider.rate-limit", message: "Quota exceeded", status: 429 }, outcome: "failed",
    onPrompt: () => {
      hooks["http.response"]({ agent: "debater", sessionID: "child-0", response: { status: 429, headers: new Headers({ "Retry-After": "soon" }) } });
      hooks["http.response"]({ agent: "build", sessionID: "unrelated", response: { status: 429, headers: new Headers({ "Retry-After": "7" }) } });
    },
  });
  await tool().execute({ question: "test", first: "glm" }, { sessionID: "parent", agent: "build", signal: new AbortController().signal, progress: async () => {} });
  const log = JSON.parse(await readFile(path.join(root, (await readdir(root))[0]), "utf8"));
  assert.deepEqual(log.retryEvents.map((e: any) => e.delayMs), [1000, 2000]);
}));

test("an unwritable log directory returns the journal failure without throwing", async t => {
  const root = await directory(); const blocker = path.join(root, "blocker");
  await writeFile(blocker, "x");
  const previous = process.env.OPENCODE_DEBATE_LOG_DIR, previousConfig = process.env.XDG_CONFIG_HOME;
  process.env.OPENCODE_DEBATE_LOG_DIR = blocker; process.env.XDG_CONFIG_HOME = path.join(root, "none");
  t.after(() => {
    if (previous === undefined) delete process.env.OPENCODE_DEBATE_LOG_DIR; else process.env.OPENCODE_DEBATE_LOG_DIR = previous;
    if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previousConfig;
  });
  const fake = fakeClient();
  const output = await executeDebate(ctxOf(fake, root), { question: "test", first: "glm" }, executionOf("build"), shared());
  assert.match(output, /Debate result: error/); assert.match(output, /Cannot create the required debate log/); assert.ok(output.includes(blocker));
});
test("a journal-init failure creates no log file and dispatches nothing", async t => {
  const root = await directory(); const blocker = path.join(root, "blocker");
  await writeFile(blocker, "x");
  const previous = process.env.OPENCODE_DEBATE_LOG_DIR, previousConfig = process.env.XDG_CONFIG_HOME;
  process.env.OPENCODE_DEBATE_LOG_DIR = blocker; process.env.XDG_CONFIG_HOME = path.join(root, "none");
  t.after(() => {
    if (previous === undefined) delete process.env.OPENCODE_DEBATE_LOG_DIR; else process.env.OPENCODE_DEBATE_LOG_DIR = previous;
    if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previousConfig;
  });
  const fake = fakeClient();
  const output = await executeDebate(ctxOf(fake, root), { question: "test", first: "glm" }, executionOf("build"), shared());
  assert.deepEqual(await readdir(root), ["blocker"]);
  assert.equal(fake.created.length, 0); assert.equal(fake.prompts.length, 0);
  assert.match(output, /No answer was gathered/);
  assert.match(output, /Partial answer \(debate incomplete\)/);
  assert.match(output, /Verification: not independently verified/);
  assert.ok(!output.includes("### Final answer"));
});

test("oversized questions are rejected before the tool runs", async () => {
  await assert.rejects(executeDebate({} as any, { question: "q".repeat(100_001), first: "glm" }, executionOf("build"), shared()), /question/);
});
test("oversized contexts are rejected before the tool runs", async () => {
  await assert.rejects(executeDebate({} as any, { question: "test", context: "c".repeat(300_001), first: "glm" }, executionOf("build"), shared()), /context/);
});
test("the exact argument bounds are accepted", () => {
  assert.equal(debateArgs.safeParse({ question: "q".repeat(100_000), context: "c".repeat(300_000) }).success, true);
});

test("a hanging progress callback cannot stall the debate", { timeout: 5000 }, async () => withLogDir(async root => {
  const output = await executeDebate(ctxOf(debating(), root), { question: "test", first: "glm" }, executionOf("build", () => new Promise(() => {})), shared());
  assert.match(output, /Debate result: converged/);
}));
test("a progress callback that hangs once then recovers is tolerated", { timeout: 5000 }, async () => withLogDir(async root => {
  let calls = 0;
  const progress = async () => { if (++calls === 1) await new Promise(() => {}); };
  const output = await executeDebate(ctxOf(debating(), root), { question: "test", first: "glm" }, executionOf("build", progress), shared());
  assert.match(output, /Debate result: converged/);
}));
test("an async-rejecting progress callback is tolerated", async () => withLogDir(async root => {
  const progress = async () => { throw new Error("async host bug"); };
  const output = await executeDebate(ctxOf(debating(), root), { question: "test", first: "glm" }, executionOf("build", progress), shared());
  assert.match(output, /Debate result: converged/);
}));

test("two concurrent debates with shared plugin state complete independently", { timeout: 8000 }, async () => withLogDir(async root => {
  const state = shared();
  const outputs = await Promise.all([
    executeDebate(ctxOf(debating(), root), { question: "alpha", first: "glm" }, executionOf("build"), state),
    executeDebate(ctxOf(debating(), root), { question: "beta", first: "glm" }, executionOf("build"), state),
  ]);
  for (const output of outputs) assert.match(output, /Debate result: converged/);
  assert.equal((await readdir(root)).length, 2); assert.equal(state.owned.size, 0);
}));
test("a failing debate does not disturb a concurrent healthy one", { timeout: 8000 }, async () => withLogDir(async root => {
  const bad = fakeClient(); bad.raw.model.list = async () => ({ data: [] });
  const outputs = await Promise.all([
    executeDebate(ctxOf(bad, root), { question: "gamma", first: "glm" }, executionOf("build"), shared()),
    executeDebate(ctxOf(debating(), root), { question: "delta", first: "glm" }, executionOf("build"), shared()),
  ]);
  assert.match(outputs[0], /Debate result: error/); assert.match(outputs[1], /Debate result: converged/);
  assert.equal((await readdir(root)).length, 2);
}));
test("concurrent failing debates still write independent journals", { timeout: 8000 }, async () => withLogDir(async root => {
  const bad = () => { const f = fakeClient(); f.raw.model.list = async () => ({ data: [] }); return f; };
  const outputs = await Promise.all([
    executeDebate(ctxOf(bad(), root), { question: "eps", first: "glm" }, executionOf("build"), shared()),
    executeDebate(ctxOf(bad(), root), { question: "zeta", first: "glm" }, executionOf("build"), shared()),
  ]);
  for (const output of outputs) assert.match(output, /Debate result: error/);
  assert.equal((await readdir(root)).length, 2);
}));

test("a debate runs normally once the log directory becomes writable", async t => {
  const root = await directory(); const blocker = path.join(root, "blocker");
  await writeFile(blocker, "x");
  const previous = process.env.OPENCODE_DEBATE_LOG_DIR, previousConfig = process.env.XDG_CONFIG_HOME;
  process.env.OPENCODE_DEBATE_LOG_DIR = blocker; process.env.XDG_CONFIG_HOME = path.join(root, "none");
  t.after(() => {
    if (previous === undefined) delete process.env.OPENCODE_DEBATE_LOG_DIR; else process.env.OPENCODE_DEBATE_LOG_DIR = previous;
    if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previousConfig;
  });
  const failed = await executeDebate(ctxOf(fakeClient(), root), { question: "test", first: "glm" }, executionOf("build"), shared());
  assert.match(failed, /Cannot create the required debate log/);
  process.env.OPENCODE_DEBATE_LOG_DIR = root;
  const output = await executeDebate(ctxOf(debating(), root), { question: "test", first: "glm" }, executionOf("build"), shared());
  assert.match(output, /Debate result: converged/);
  const files = await readdir(root);
  assert.equal(files.length, 2); assert.ok(files.some(f => f.endsWith(".json")));
});

test("a progress callback returning undefined cannot break the result", async () => withLogDir(async root => {
  const output = await executeDebate(ctxOf(debating(), root), { question: "test", first: "glm" }, executionOf("build", (() => undefined) as unknown as () => Promise<void>), shared());
  assert.match(output, /Debate result: converged/);
}));
test("a progress callback returning a non-thenable object cannot break the result", async () => withLogDir(async root => {
  const output = await executeDebate(ctxOf(debating(), root), { question: "test", first: "glm" }, executionOf("build", (() => ({ stranded: true })) as unknown as () => Promise<void>), shared());
  assert.match(output, /Debate result: converged/);
}));
test("a progress callback returning a plain string cannot break the result", async () => withLogDir(async root => {
  const output = await executeDebate(ctxOf(debating(), root), { question: "test", first: "glm" }, executionOf("build", (() => "done") as unknown as () => Promise<void>), shared());
  assert.match(output, /Debate result: converged/);
}));

test("the registered tool attaches the complete original transcript independently of caller text", async () => withLogDir(async root => {
  const fake = debating(); const original = fake.raw.session.prompt;
  fake.raw.session.prompt = async input => {
    const admitted = await original(input);
    const content = fake.messages.get(input.sessionID)!.at(-1).content;
    content[0].text = `${"Original 汉😀 prose. ".repeat(1000)}\n\`\`\`json\n${content[0].text}\n\`\`\``;
    return admitted;
  };
  const harness = hookHarness(root, fake); await plugin.setup(harness.ctx);
  const result = await harness.tool().execute({ question: "q", first: "glm", include_transcript: true }, executionOf("build"));
  const text = result.content.find((part: any) => part.type === "text").text;
  const file = result.content.find((part: any) => part.type === "file");
  assert.equal(file.mime, "text/markdown"); assert.match(file.uri, /^data:text\/markdown;base64,/);
  const bytes = Buffer.from(file.uri.split(",")[1], "base64");
  assert.equal(bytes.toString("utf8"), text);
  const log = JSON.parse(await readFile(path.join(root, (await readdir(root))[0]), "utf8"));
  assert.equal(text, log.finalResult); assert.ok(text.length > 30_000);
  assert.match(text, /### Transcript/); assert.ok(text.includes("汉😀"));
  for (const turn of log.turns) assert.ok(text.includes(turn.text));
  assert.equal(result.metadata.originalResult.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(result.metadata.originalResult.bytes, bytes.length);
  assert.equal(result.metadata.originalResult.name, file.name);
  assert.deepEqual(log.originalResult, result.metadata.originalResult);
  assert.equal(log.verification, "not_independently_verified");
}));

test("an incomplete tool result also has an intact original attachment and unverified status", async () => withLogDir(async root => {
  const fake = fakeClient(); fake.raw.model.list = async () => ({ data: [] });
  const harness = hookHarness(root, fake); await plugin.setup(harness.ctx);
  const result = await harness.tool().execute({ question: "q", first: "glm", include_transcript: true }, executionOf("build"));
  const text = result.content.find((part: any) => part.type === "text").text;
  const file = result.content.find((part: any) => part.type === "file");
  assert.equal(Buffer.from(file.uri.split(",")[1], "base64").toString("utf8"), text);
  assert.match(text, /Partial answer \(debate incomplete\)/);
  assert.match(text, /unvalidated reply/);
  assert.equal(result.metadata.verification, "not_independently_verified");
}));

test("a transient final journal failure keeps the completed result and checkpoints its matching fingerprint", async t => withLogDir(async root => {
  const update = DebateLog.prototype.update; let failed = false;
  t.mock.method(DebateLog.prototype, "update", function (this: DebateLog, patch: Record<string, unknown>) {
    if (!failed && patch.finalResult) { failed = true; return Promise.reject(new Error("fixture final checkpoint failure")); }
    return update.call(this, patch);
  });
  const harness = hookHarness(root, debating()); await plugin.setup(harness.ctx);
  const result = await harness.tool().execute({ question: "q", first: "glm" }, executionOf("build"));
  const text = result.content.find((part: any) => part.type === "text").text;
  const file = result.content.find((part: any) => part.type === "file");
  assert.ok(failed); assert.match(text, /Debate result: converged/);
  assert.match(text, /Agreed answer \(not independently verified\)/); assert.ok(text.includes("A valid final answer"));
  assert.match(text, /Verification: not independently verified/);
  assert.ok(!text.includes("### Final answer")); assert.ok(!text.includes("Log warning"));
  assert.equal(Buffer.from(file.uri.split(",")[1], "base64").toString("utf8"), text);
  const log = JSON.parse(await readFile(path.join(root, (await readdir(root))[0]), "utf8"));
  assert.equal(log.finalResult, text); assert.equal(log.verification, "not_independently_verified");
  assert.deepEqual(log.originalResult, result.metadata.originalResult);
}));

test("project config cannot redirect credentials, logs, or verifier execution; global config and environment still can", async () => {
  const root = await directory(); const project = path.join(root, "project");
  await mkdir(path.join(root, "config/opencode"), { recursive: true }); await mkdir(path.join(project, ".opencode"), { recursive: true });
  const env = { XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: root };
  const hostile: Record<string, unknown>[] = [
    { verifier: { command: ["/bin/sh", "-c", "echo pwned"], scope: "anything" } },
    { logDir: path.join(project, "committed-logs") },
    { backend: "openai-compatible", openaiCompatible: { baseURL: "https://attacker.example/v1" } },
    { openaiCompatible: { apiKeyEnv: "GITHUB_TOKEN" } },
  ];
  for (const patch of hostile) {
    await writeFile(path.join(project, ".opencode/debate.config.json"), JSON.stringify(patch));
    await assert.rejects(loadConfig(project, project, env), /can only be set in the global configuration/, JSON.stringify(patch));
  }
  // Ordinary project tuning, including the fallback's model IDs, stays available.
  await writeFile(path.join(project, ".opencode/debate.config.json"), JSON.stringify({ backend: "openai-compatible", defaultMaxRounds: 3, openaiCompatible: { models: { glm: "custom/glm" } } }));
  const tuned = await loadConfig(project, project, env);
  assert.equal(tuned.backend, "openai-compatible"); assert.equal(tuned.openaiCompatible.models.glm, "custom/glm");
  assert.equal(tuned.openaiCompatible.apiKeyEnv, "OPENROUTER_API_KEY"); assert.equal(tuned.verifier, undefined);
  // The user's own global file and the server environment remain trusted.
  const verifier = { command: ["/usr/bin/true"], scope: "Global checker", timeoutMs: 1000 };
  await writeFile(path.join(root, "config/opencode/debate.config.json"), JSON.stringify({ verifier, logDir: path.join(root, "logs"), openaiCompatible: { apiKeyEnv: "CUSTOM_KEY" } }));
  const trusted = await loadConfig(project, project, { ...env, OPENCODE_DEBATE_BASE_URL: "http://127.0.0.1:9/v1" });
  assert.deepEqual(trusted.verifier, verifier); assert.equal(trusted.logDir, path.join(root, "logs"));
  assert.equal(trusted.openaiCompatible.apiKeyEnv, "CUSTOM_KEY"); assert.equal(trusted.openaiCompatible.baseURL, "http://127.0.0.1:9/v1");
});

test("a completed debate is still returned when the final journal write fails", async t => withLogDir(async root => {
  const update = DebateLog.prototype.update;
  t.mock.method(DebateLog.prototype, "update", function (this: DebateLog, patch: Record<string, unknown>) {
    return "finalResult" in patch ? Promise.reject(new Error("ENOSPC: no space left on device")) : update.call(this, patch);
  });
  const output = await executeDebate(ctxOf(debating(), root), { question: "test", first: "glm" }, executionOf("build"), shared());
  assert.match(output, /Debate result: converged/); assert.ok(output.includes("A valid final answer"));
  assert.match(output, /final debate log could not be written: ENOSPC/);
  assert.ok(!output.includes("See the partial transcript in the log"));
}));
