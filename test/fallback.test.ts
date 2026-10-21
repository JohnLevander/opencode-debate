import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "@opencode/plugin";
import { OpenAICompatibleAdapter } from "../src/adapters/openai-compatible.ts";
import { defaults, loadConfig, configSchema } from "../src/config.ts";
import { runDebate } from "../src/core/debate.ts";
import { DebateError } from "../src/core/types.ts";
import { DEBATER_SYSTEM, INTERRUPTION_PREFIX } from "../src/prompts.ts";
import { executeDebate } from "../src/index.ts";
import { mockCompletions, completion, json } from "./helpers/http.ts";

const key = "local-mock-credential";
function config(baseURL: string) {
  const value = defaults(); value.backend = "openai-compatible";
  value.openaiCompatible.baseURL = baseURL; value.openaiCompatible.apiKeyEnv = "DEBATE_TEST_API_KEY";
  return value;
}
const reply = (agrees: boolean) => JSON.stringify({ answer: "A tested answer", points: [], agrees_with_current_answer: agrees, confidence: 0.9 });
const signal = () => new AbortController().signal;

test("fallback sends authenticated tool-free requests and isolates per-model text history", async t => {
  const server = await mockCompletions(t, (_request, response, n) => json(response, completion(`reply-${n}`,
    n === 1 ? { reasoning: "private-reasoning" } : n === 2 ? { reasoning_content: "private-alias" } : { reasoning_details: [{ type: "reasoning.text", text: "private-details" }] })));
  const cfg = config(`${server.baseURL}/`); const adapter = new OpenAICompatibleAdapter(cfg, { DEBATE_TEST_API_KEY: key });
  t.after(() => adapter.release());
  assert.equal((await adapter.callModel("glm", "opening", signal())).reasoning, "private-reasoning");
  assert.equal((await adapter.callModel("deepseek", "critique", signal())).reasoning, "private-alias");
  assert.match((await adapter.callModel("glm", "revision", signal())).reasoning!, /private-details/);
  assert.equal(server.requests.length, 3);
  for (const request of server.requests) {
    assert.equal(request.method, "POST"); assert.equal(request.url, "/v1/chat/completions");
    assert.equal(request.authorization, `Bearer ${key}`); assert.equal(request.body.stream, false);
    assert.deepEqual(Object.keys(request.body).sort(), ["messages", "model", "stream"]);
    assert.equal(request.body.messages[0].content, DEBATER_SYSTEM);
    assert.ok(!JSON.stringify(request.body).includes("private-"));
  }
  assert.equal(server.requests[0].body.model, "z-ai/glm-5.3-flash");
  assert.equal(server.requests[1].body.model, "deepseek/deepseek-v4.1-flash");
  assert.deepEqual(server.requests[1].body.messages.map((m: any) => m.content), [DEBATER_SYSTEM, "critique"]);
  assert.deepEqual(server.requests[2].body.messages.map((m: any) => m.content), [DEBATER_SYSTEM, "opening", "reply-1", "revision"]);
});

test("fallback missing credentials fails before fetch; closed adapters cannot dispatch", async () => {
  let calls = 0;
  const adapter = new OpenAICompatibleAdapter(config("http://127.0.0.1:1/v1"), {}, (async () => { calls++; throw new Error(); }) as typeof fetch);
  await assert.rejects(adapter.callModel("glm", "question", signal()), /Missing API key: set DEBATE_TEST_API_KEY/);
  await adapter.cancelAll(); await assert.rejects(adapter.callModel("deepseek", "question", signal()), /adapter is closed/);
  assert.equal(calls, 0);
});

test("fallback rejects malformed, truncated, tool, refusal and reasoning-only replies", async t => {
  const cases = [completion("text", {}, "length"), completion("text", {}, null), completion("", { reasoning: "only reasoning" }),
    completion("text", { tool_calls: [{ id: "call" }] }), completion("text", { function_call: { name: "shell" } }),
    completion("text", { refusal: "no" }), { choices: [] }];
  const server = await mockCompletions(t, (_request, response, n) => {
    if (n > cases.length) { response.end("not JSON"); return; } json(response, cases[n - 1]);
  });
  const adapter = new OpenAICompatibleAdapter(config(server.baseURL), { DEBATE_TEST_API_KEY: key }); t.after(() => adapter.release());
  for (const _case of cases) await assert.rejects(adapter.callModel("glm", "question", signal()), /no complete, untruncated/);
  await assert.rejects(adapter.callModel("glm", "question", signal()), /invalid JSON/);
  assert.ok(server.requests.every(r => r.body.messages.length === 2));
});

test("fallback reports HTTP errors without echoing provider bodies or credentials", async t => {
  const server = await mockCompletions(t, (_request, response) => json(response, { error: { message: `Bearer ${key}` } }, 401));
  const adapter = new OpenAICompatibleAdapter(config(server.baseURL), { DEBATE_TEST_API_KEY: key }); t.after(() => adapter.release());
  await assert.rejects(adapter.callModel("glm", "question", signal()), (error: unknown) => {
    assert.ok(error instanceof DebateError); assert.match(error.message, /HTTP 401/); assert.ok(!error.message.includes(key)); return true;
  });
});

test("fallback maps 429 and compatible error envelopes to engine Retry-After hints", async t => {
  const server = await mockCompletions(t, (_request, response, n) => {
    response.setHeader("Retry-After", "2");
    json(response, { error: { code: n === 1 ? 429 : "rate_limit_exceeded" } }, n === 1 ? 429 : 200);
  });
  const adapter = new OpenAICompatibleAdapter(config(server.baseURL), { DEBATE_TEST_API_KEY: key }); t.after(() => adapter.release());
  for (let n = 0; n < 2; n++) await assert.rejects(adapter.callModel("glm", "question", signal()), (error: unknown) => {
    assert.ok(error instanceof DebateError); assert.equal(error.code, "rate_limit"); assert.equal(error.retryAfterMs, 2000); return true;
  });
});

test("fallback abort closes a response body that never finishes", { timeout: 3000 }, async t => {
  let received!: () => void, disconnected!: () => void;
  const ready = new Promise<void>(resolve => { received = resolve; });
  const closed = new Promise<void>(resolve => { disconnected = resolve; });
  const server = await mockCompletions(t, (_request, response) => {
    response.on("close", disconnected); response.writeHead(200, { "Content-Type": "application/json" }); response.flushHeaders(); received();
  });
  const adapter = new OpenAICompatibleAdapter(config(server.baseURL), { DEBATE_TEST_API_KEY: key }); t.after(() => adapter.release());
  const controller = new AbortController(); const pending = adapter.callModel("glm", "question", controller.signal);
  const rejected = assert.rejects(pending, /test cancellation/);
  await ready; controller.abort(new DebateError("cancelled", "test cancellation")); await rejected; await closed;
});

test("fallback discards a late fetch result even when the transport ignores abort", async () => {
  let finish!: (response: Response) => void;
  const late = new Promise<Response>(resolve => { finish = resolve; }); let calls = 0;
  const adapter = new OpenAICompatibleAdapter(config("http://127.0.0.1:1/v1"), { DEBATE_TEST_API_KEY: key },
    (async (_url, init) => { calls++; return calls === 1 ? late : Response.json(completion(String(JSON.parse(init!.body as string).messages.length))); }) as typeof fetch);
  const controller = new AbortController(); const pending = adapter.callModel("glm", "timed out", controller.signal);
  const rejected = assert.rejects(pending, /test timeout/);
  controller.abort(new DebateError("call_timeout", "test timeout")); await rejected;
  finish(Response.json(completion("late reply"))); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await adapter.callModel("glm", "retry", signal())).text, "2"); adapter.release();
});

test("fallback engine timeout retries once with the interruption prefix", { timeout: 5000 }, async t => {
  const server = await mockCompletions(t, (_request, response, n) => {
    if (n === 1) { response.writeHead(200); response.flushHeaders(); return; }
    json(response, completion(reply(n === 3)));
  });
  const adapter = new OpenAICompatibleAdapter(config(server.baseURL), { DEBATE_TEST_API_KEY: key }); t.after(() => adapter.release());
  const result = await runDebate({ question: "test", maxRounds: 1, first: "glm", callTimeoutMs: 200, totalTimeoutMs: 4000, callModel: adapter.callModel });
  assert.equal(result.status, "converged"); assert.equal(server.requests.length, 3);
  assert.ok(server.requests[1].body.messages.at(-1).content.startsWith(INTERRUPTION_PREFIX));
  assert.equal(server.requests[1].body.messages.length, 2); assert.equal(result.turns[0].retries, 1);
});

test("fallback engine JSON repair retains the malformed assistant reply in its own history", async t => {
  const server = await mockCompletions(t, (_request, response, n) => json(response, completion(n === 1 ? "malformed reply" : reply(n === 3))));
  const adapter = new OpenAICompatibleAdapter(config(server.baseURL), { DEBATE_TEST_API_KEY: key }); t.after(() => adapter.release());
  const result = await runDebate({ question: "test", maxRounds: 1, first: "glm", callTimeoutMs: 2000, totalTimeoutMs: 5000, callModel: adapter.callModel });
  assert.equal(result.status, "converged");
  assert.equal(server.requests[1].body.messages.at(-2).content, "malformed reply");
  assert.match(server.requests[1].body.messages.at(-1).content, /You are the PROPOSER/);
  assert.match(server.requests[1].body.messages.at(-1).content, /Provide your full nonempty answer/);
});

test("fallback configuration supports endpoint, key-env and independent model overrides", async () => {
  await mkdir(".test-runtime", { recursive: true }); const root = await mkdtemp(path.resolve(".test-runtime/fallback-config-"));
  const cfg = await loadConfig(root, root, { XDG_CONFIG_HOME: root, OPENCODE_DEBATE_BACKEND: "openai-compatible",
    OPENCODE_DEBATE_BASE_URL: "http://127.0.0.1:1234/v1", OPENCODE_DEBATE_FALLBACK_API_KEY_ENV: "CUSTOM_KEY",
    OPENCODE_DEBATE_FALLBACK_GLM_MODEL_ID: "custom/glm", OPENCODE_DEBATE_FALLBACK_DEEPSEEK_MODEL_ID: "custom/deepseek" });
  assert.equal(cfg.backend, "openai-compatible"); assert.equal(cfg.openaiCompatible.apiKeyEnv, "CUSTOM_KEY");
  assert.equal(cfg.openaiCompatible.baseURL, "http://127.0.0.1:1234/v1");
  assert.deepEqual(cfg.openaiCompatible.models, { glm: "custom/glm", deepseek: "custom/deepseek" });
  for (const baseURL of ["not a URL", "file:///tmp/api", "https://user:password@example.com/v1", "https://example.com/v1?key=hidden", "https://example.com/v1#fragment"]) {
    assert.equal(configSchema.safeParse(config(baseURL)).success, false);
  }
});

for (const scenario of ["converged", "cancelled", "rate_limit", "missing_key"] as const) {
  test(`fallback tool path logs ${scenario} with correct model labels and no SDK child calls`, { timeout: 6000 }, async t => {
    const controller = new AbortController();
    const server = await mockCompletions(t, (_request, response, n) => {
      if (scenario === "rate_limit" && n === 1) { response.setHeader("Retry-After", "0"); json(response, { error: { code: 429 } }, 429); return; }
      if (scenario === "cancelled" && n === 2) { controller.abort(); return; }
      json(response, completion(reply(scenario === "rate_limit" ? n === 3 : n === 2), { reasoning: "private local reasoning" }));
    });
    await mkdir(".test-runtime", { recursive: true }); const root = await mkdtemp(path.resolve(".test-runtime/fallback-"));
    const cfg = config(server.baseURL); cfg.logDir = path.join(root, "logs");
    cfg.openaiCompatible.apiKeyEnv = "OPENCODE_DEBATE_LOCAL_MOCK_KEY";
    await mkdir(path.join(root, ".opencode")); await writeFile(path.join(root, ".opencode/debate.config.json"), JSON.stringify(cfg));
    const oldKey = process.env.OPENCODE_DEBATE_LOCAL_MOCK_KEY;
    if (scenario !== "missing_key") process.env.OPENCODE_DEBATE_LOCAL_MOCK_KEY = key; else delete process.env.OPENCODE_DEBATE_LOCAL_MOCK_KEY;
    t.after(() => { if (oldKey === undefined) delete process.env.OPENCODE_DEBATE_LOCAL_MOCK_KEY; else process.env.OPENCODE_DEBATE_LOCAL_MOCK_KEY = oldKey; });
    // Any SDK call fails: fallback conversations must stay entirely in memory.
    const ctx = { location: { directory: root, project: { directory: root } }, app: { version: "2.0.32" },
      session: new Proxy({}, { get() { throw new Error("Unexpected SDK child access"); } }), model: new Proxy({}, { get() { throw new Error("Unexpected SDK model access"); } }),
    } as unknown as Plugin.Context;
    const output = await executeDebate(ctx, { question: "test", first: "glm", include_transcript: true }, {
      sessionID: "parent", agent: "build", signal: controller.signal, progress: async () => {},
    }, new Set());
    const status = scenario === "missing_key" ? "error" : scenario === "rate_limit" ? "converged" : scenario;
    assert.match(output, new RegExp(`Debate result: ${status}`));
    assert.match(output, /Proposer: z-ai\/glm-5.3-flash \| Challenger: deepseek\/deepseek-v4.1-flash/);
    assert.match(output, /In-memory fallback conversations/); assert.ok(!output.includes("opencode/glm"));
    const logText = await readFile(path.join(cfg.logDir, (await readdir(cfg.logDir))[0]), "utf8"); const log = JSON.parse(logText);
    assert.equal(log.status, status); assert.equal(log.finalResult, output); assert.deepEqual(log.sessions, []);
    assert.ok(!logText.includes(key)); assert.ok(!output.includes("private local reasoning"));
    if (scenario !== "missing_key") assert.equal(log.turns[0].reasoning, "private local reasoning");
    if (scenario === "cancelled") assert.equal(log.answer, "A tested answer");
    if (scenario === "rate_limit") { assert.equal(log.turns[0].retries, 1); assert.equal(server.requests.length, 3); }
    if (scenario === "missing_key") assert.equal(server.requests.length, 0);
  });
}


test("fallback cancelAll aborts both in-flight debaters", { timeout: 3000 }, async t => {
  let admitted!: () => void, disconnected!: () => void; let count = 0, closedCount = 0;
  const ready = new Promise<void>(resolve => { admitted = resolve; });
  const closed = new Promise<void>(resolve => { disconnected = resolve; });
  const server = await mockCompletions(t, (_request, response) => {
    response.on("close", () => { if (++closedCount === 2) disconnected(); });
    response.writeHead(200); response.flushHeaders(); if (++count === 2) admitted();
  });
  const adapter = new OpenAICompatibleAdapter(config(server.baseURL), { DEBATE_TEST_API_KEY: key }); t.after(() => adapter.release());
  const proposer = assert.rejects(adapter.callModel("glm", "proposal", signal()), /cancelled/);
  const challenger = assert.rejects(adapter.callModel("deepseek", "critique", signal()), /cancelled/);
  await ready; await adapter.cancelAll(); await Promise.all([proposer, challenger]); await closed;
});

for (const scenario of ["double_timeout", "total_deadline"] as const) {
  test(`fallback ${scenario} returns a bounded error and closes HTTP requests`, { timeout: 3000 }, async t => {
    const server = await mockCompletions(t, (_request, response) => { response.writeHead(200); response.flushHeaders(); });
    const adapter = new OpenAICompatibleAdapter(config(server.baseURL), { DEBATE_TEST_API_KEY: key }); t.after(() => adapter.release());
    const result = await runDebate({ question: "test", maxRounds: 1, first: "glm", callModel: adapter.callModel,
      callTimeoutMs: scenario === "double_timeout" ? 100 : 2000, totalTimeoutMs: scenario === "double_timeout" ? 2000 : 100 });
    assert.equal(result.status, "error");
    assert.match(result.reason, scenario === "double_timeout" ? /Call timeout/ : /Total debate deadline/);
    assert.equal(server.requests.length, scenario === "double_timeout" ? 2 : 1);
    assert.equal(result.answer, null); assert.equal(result.turns[0].attempts.length, scenario === "double_timeout" ? 2 : 1);
  });
}
