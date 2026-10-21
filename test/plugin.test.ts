import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import plugin, { executeDebate, debateArgs } from "../src/index.ts";
import { DEBATER_SYSTEM, TOOL_DESCRIPTION, COMMAND_BODY, COMMAND_DESCRIPTION } from "../src/prompts.ts";
import { defaults, loadConfig } from "../src/config.ts";
import { DebateLog } from "../src/log.ts";
import { fakeClient } from "./helpers/fake.ts";
import type { Plugin } from "@opencode/plugin";

async function directory() { await mkdir(".test-runtime", { recursive: true }); return mkdtemp(path.resolve(".test-runtime/test-")); }
test("v2 tool registration preserves exact description and hides/isolates debater", async () => {
  const hooks: Record<string, Function> = {}; let agent: any = {}; let tool: any;
  const ctx = {
    agent: { list: async () => ({ data: [] }), transform: async (fn: Function) => fn({ update: (_id: string, update: Function) => update(agent) }) },
    session: { hook: async (name: string, fn: Function) => { hooks[name] = fn; } },
    tool: { hook: async (name: string, fn: Function) => { hooks[`tool.${name}`] = fn; }, transform: async (fn: Function) => fn({ add: (value: any) => { tool = value; } }) },
  } as unknown as Plugin.Context;
  await plugin.setup(ctx);
  assert.equal(tool.description, TOOL_DESCRIPTION); assert.equal(tool.name, "debate");
  assert.equal(agent.hidden, true); assert.equal(agent.mode, "subagent"); assert.equal(agent.system, DEBATER_SYSTEM);
  assert.deepEqual(agent.permissions, [{ action: "*", resource: "*", effect: "deny" }]);
  const event = { agent: "debater", sessionID: "child", tools: { debate: {}, shell: {}, mcp_custom: {} }, system: [{ type: "text", text: "Host harness instructions" }] as { type: string; text: string }[] };
  await hooks.context(event); assert.deepEqual(event.tools, {}); assert.equal(event.system[0].text, "Host harness instructions"); assert.equal(event.system.length, 1);
  const parent = { ...event, agent: "build", tools: { shell: {} } }; await hooks.context(parent); assert.deepEqual(parent.tools, { shell: {} });
  const retry = { agent: "debater", decision: { retry: true } }; hooks.retry(retry); assert.deepEqual(retry.decision, { retry: false });
  assert.ok(debateArgs.safeParse({ question: "Question", max_rounds: 8 }).success);
  assert.ok(!debateArgs.safeParse({ question: "Question", max_rounds: 9 }).success);
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
test("tool writes an error log when a model is unavailable", async t => {
  const root = await directory(); const previous = process.env.OPENCODE_DEBATE_LOG_DIR;
  process.env.OPENCODE_DEBATE_LOG_DIR = root; t.after(() => { if (previous === undefined) delete process.env.OPENCODE_DEBATE_LOG_DIR; else process.env.OPENCODE_DEBATE_LOG_DIR = previous; });
  const fake = fakeClient(); fake.raw.model.list = async () => ({ data: [] });
  const ctx = { ...fake.client, location: { directory: root, project: { directory: root } }, app: { version: "2.0.32" } } as unknown as Plugin.Context;
  const output = await executeDebate(ctx, { question: "test", first: "glm" }, { sessionID: "parent", agent: "build", signal: new AbortController().signal, progress: async () => {} }, new Set());
  assert.match(output, /Debate result: error/);
  const log = JSON.parse(await readFile(path.join(root, (await readdir(root))[0]), "utf8"));
  assert.equal(log.status, "error"); assert.match(log.reason, /glm-5.3-flash-free.*unavailable/); assert.equal(log.finalResult, output); assert.equal(log.sessions.length, 0);
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
      content[0].text = JSON.stringify({ answer: "A valid final answer", points: [], agrees_with_current_answer: fake.prompts.length > 1, confidence: 0.9 });
      content.splice(1, 1);
      if (scenario === "cancelled" && fake.prompts.length > 1) controller.abort();
      return admitted;
    };
    if (scenario === "timeout") fake.change({ onWait: async () => { if (fake.prompts.length) await new Promise<void>(() => {}); } });
    const ctx = { ...fake.client, location: { directory: root, project: { directory: root } }, app: { version: "2.0.32" } } as unknown as Plugin.Context;
    const progress: string[] = [];
    const output = await executeDebate(ctx, { question: "test", first: "glm", include_transcript: true }, {
      sessionID: "parent", agent: "build", signal: controller.signal, progress: async data => { progress.push(String(data.description)); },
    }, new Set());
    const expected = scenario === "timeout" ? "error" : scenario;
    assert.match(output, new RegExp(`Debate result: ${expected}`));
    const log = JSON.parse(await readFile(path.join(root, (await readdir(root))[0]), "utf8"));
    assert.equal(log.status, expected); assert.equal(log.sessions.length, 2); assert.equal(fake.created.length, 2);
    assert.equal(log.finalResult, output); assert.ok(progress.length >= 3);
    if (scenario === "converged") {
      assert.equal(log.turns[0].reasoning, "secret reasoning"); assert.ok(!fake.prompts[1].text.includes("secret reasoning"));
      assert.match(output, /### Transcript/); assert.equal(log.answer, "A valid final answer");
    } else { assert.ok(fake.interrupts.includes("child-0")); assert.ok(fake.interrupts.includes("child-1")); assert.ok(log.interruptions.some((entry: any) => entry.sessionID === "child-0" && entry.acknowledgedAt)); assert.ok(log.interruptions.some((entry: any) => entry.sessionID === "child-1" && entry.acknowledgedAt)); }
  });
}
