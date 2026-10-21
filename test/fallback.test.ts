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
import { tempRoot } from "./helpers/temp.ts";

const key = "local-mock-credential";
function config(baseURL: string) {
  const value = defaults(); value.backend = "openai-compatible";
  value.openaiCompatible.baseURL = baseURL; value.openaiCompatible.apiKeyEnv = "DEBATE_TEST_API_KEY";
  return value;
}
const reply = (agrees: boolean) => JSON.stringify({ answer: agrees ? null : "A tested answer", points: [], agrees_with_current_answer: agrees, confidence: 0.9 });
const signal = () => new AbortController().signal;
// A real Response whose body stream fails mid-transfer, as when a socket drops after headers arrive.
function interruptedBody(status: number) {
  return new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"choices":')); controller.error(new TypeError("read ECONNRESET")); },
  }), { status, headers: { "Content-Type": "application/json" } });
}

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
  await mkdir(".test-runtime", { recursive: true }); const root = await tempRoot("fallback-config-");
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
    await mkdir(".test-runtime", { recursive: true }); const root = await tempRoot("fallback-");
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
    }, { owned: new Set(), retryHints: new Map(), restrictedReads: new Map() });
    const status = scenario === "missing_key" ? "error" : scenario === "rate_limit" ? "converged" : scenario;
    assert.match(output, new RegExp(`Debate result: ${status}`));
    assert.match(output, /Proposer: z-ai\/glm-5.3-flash \| Challenger: deepseek\/deepseek-v4.1-flash/);
    assert.match(output, /In-memory fallback conversations/); assert.ok(!output.includes("opencode/glm"));
    const logText = await readFile(path.join(cfg.logDir, (await readdir(cfg.logDir))[0]), "utf8"); const log = JSON.parse(logText);
    assert.equal(log.status, status); assert.equal(log.finalResult, output); assert.deepEqual(log.sessions, []);
    assert.ok(!logText.includes(key)); assert.ok(!output.includes("private local reasoning"));
    if (scenario !== "missing_key") assert.equal(log.turns[0].reasoning, "private local reasoning");
    if (scenario === "cancelled") assert.equal(log.answer, "A tested answer");
    if (scenario === "rate_limit") {
      assert.equal(log.turns[0].retries, 1); assert.equal(server.requests.length, 3);
      assert.equal(log.retryEvents.length, 1); assert.equal(log.retryEvents[0].reason, "rate_limit");
      assert.equal(log.retryEvents[0].delayMs, 1000); assert.ok(log.retryEvents[0].at > 0);
    }
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

for (const status of [408, 429, 500, 502, 503, 504, 400, 401, 403, 404, 501]) {
  test(`fallback HTTP ${status} has an explicit retry classification`, async () => {
    const adapter = new OpenAICompatibleAdapter(config("http://127.0.0.1:1/v1"), { DEBATE_TEST_API_KEY: key },
      (async () => new Response(`never echo ${key}`, { status, headers: { "Retry-After": "4" } })) as typeof fetch);
    try {
      await assert.rejects(adapter.callModel("glm", "question", signal()), error => {
        assert.ok(error instanceof DebateError);
        assert.equal(error.code, status === 429 ? "rate_limit" : [408, 500, 502, 503, 504].includes(status) ? "provider_unavailable" : "transport");
        assert.equal(error.retryAfterMs, 4000); assert.ok(!error.message.includes(key)); return true;
      });
    } finally { adapter.release(); }
  });
}

test("fallback network failures and service error envelopes are retryable without leaking bodies", async () => {
  for (const request of [
    async () => { throw new TypeError(`socket closed ${key}`); },
    async () => Response.json({ error: { code: "503", message: key } }),
    async () => Response.json({ error: { type: "service_unavailable", message: key } }),
  ]) {
    const adapter = new OpenAICompatibleAdapter(config("http://127.0.0.1:1/v1"), { DEBATE_TEST_API_KEY: key }, request as typeof fetch);
    try {
      await assert.rejects(adapter.callModel("glm", "question", signal()), error => {
        assert.ok(error instanceof DebateError); assert.equal(error.code, "provider_unavailable");
        assert.ok(!error.message.includes(key)); return true;
      });
    } finally { adapter.release(); }
  }
});

test("fallback 429 envelope carrying an outage message classifies as provider_unavailable", async () => {
  const adapter = new OpenAICompatibleAdapter(config("http://127.0.0.1:1/v1"), { DEBATE_TEST_API_KEY: key },
    (async () => Response.json({ error: { code: "429", message: "Upstream request failed: Endpoint is unavailable." } })) as typeof fetch);
  try {
    await assert.rejects(adapter.callModel("glm", "question", signal()), error => {
      assert.ok(error instanceof DebateError); assert.equal(error.code, "provider_unavailable");
      assert.ok(!error.message.includes("Endpoint is unavailable")); return true;
    });
  } finally { adapter.release(); }
});

test("fallback engine recovers from HTTP 503 without appending the failed request to history", async t => {
  const server = await mockCompletions(t, (_request, response, n) => {
    if (n === 1) { json(response, { error: { message: key } }, 503); return; }
    json(response, completion(reply(n === 3)));
  });
  const adapter = new OpenAICompatibleAdapter(config(server.baseURL), { DEBATE_TEST_API_KEY: key }); t.after(() => adapter.release());
  const result = await runDebate({ question: "test", maxRounds: 1, first: "glm", callTimeoutMs: 2000, totalTimeoutMs: 5000, callModel: adapter.callModel });
  assert.equal(result.status, "converged"); assert.equal(server.requests.length, 3);
  assert.deepEqual(server.requests[1].body.messages, server.requests[0].body.messages);
  assert.equal(result.turns[0].attempts[0].errorCode, "provider_unavailable");
  assert.equal(result.turns[0].attempts[1].kind, "provider_retry");
});

test("compatible adapter preserves a permanent 404 inside an HTTP-200 error envelope containing an outage phrase", async () => {
  const adapter = new OpenAICompatibleAdapter(config("http://127.0.0.1:1/v1"), { DEBATE_TEST_API_KEY: key },
    (async () => Response.json({ error: { code: "404", message: "Upstream request failed: Endpoint is unavailable." } })) as typeof fetch);
  try {
    await assert.rejects(adapter.callModel("glm", "question", signal()), error => {
      assert.ok(error instanceof DebateError); assert.equal(error.code, "transport");
      assert.match(error.message, /error envelope/);
      assert.ok(!error.message.includes("Endpoint is unavailable")); return true;
    });
  } finally { adapter.release(); }
});

test("HTTP 200 followed by a body-stream network failure is provider_unavailable, not invalid JSON", async () => {
  const adapter = new OpenAICompatibleAdapter(config("http://127.0.0.1:1/v1"), { DEBATE_TEST_API_KEY: key },
    (async () => interruptedBody(200)) as typeof fetch);
  try {
    await assert.rejects(adapter.callModel("glm", "question", signal()), error => {
      assert.ok(error instanceof DebateError); assert.equal(error.code, "provider_unavailable");
      assert.doesNotMatch(error.message, /invalid JSON/); return true;
    });
  } finally { adapter.release(); }
});

test("compatible envelope classifies a 529 overload as provider_unavailable", async () => {
  const adapter = new OpenAICompatibleAdapter(config("http://127.0.0.1:1/v1"), { DEBATE_TEST_API_KEY: key },
    (async () => Response.json({ error: { code: "529", message: "The API is temporarily overloaded" } })) as typeof fetch);
  try {
    await assert.rejects(adapter.callModel("glm", "question", signal()), error => {
      assert.ok(error instanceof DebateError); assert.equal(error.code, "provider_unavailable");
      assert.ok(!error.message.includes("temporarily overloaded")); return true;
    });
  } finally { adapter.release(); }
});

test("string-valued error envelopes classify by their wording", async () => {
  const adapter = new OpenAICompatibleAdapter(config("http://127.0.0.1:1/v1"), { DEBATE_TEST_API_KEY: key },
    (async () => Response.json({ error: "The service is temporarily overloaded" })) as typeof fetch);
  try {
    await assert.rejects(adapter.callModel("glm", "question", signal()), error => {
      assert.ok(error instanceof DebateError); assert.equal(error.code, "provider_unavailable");
      assert.ok(!error.message.includes("temporarily overloaded")); return true;
    });
  } finally { adapter.release(); }
});

test("oversized responses are rejected permanently instead of being buffered", async () => {
  const limit = 16 * 1024 * 1024;
  const chunk = "x".repeat(5 * 1024 * 1024);
  for (const body of [new Response("x".repeat(limit + 1)),
    new Response(new ReadableStream({ start(c) { for (let i = 0; i < 4; i++) c.enqueue(new TextEncoder().encode(chunk)); c.close(); } }))] as Response[]) {
    const adapter = new OpenAICompatibleAdapter(config("http://127.0.0.1:1/v1"), { DEBATE_TEST_API_KEY: key },
      (async () => body) as typeof fetch);
    try {
      await assert.rejects(adapter.callModel("glm", "question", signal()), error => {
        assert.ok(error instanceof DebateError); assert.equal(error.code, "transport");
        assert.match(error.message, /oversized/); return true;
      });
    } finally { adapter.release(); }
  }
});

test("an API key containing control characters fails before any request", async () => {
  let calls = 0;
  const adapter = new OpenAICompatibleAdapter(config("http://127.0.0.1:1/v1"), { DEBATE_TEST_API_KEY: "bad\r\nX-Injected: 1" },
    (async () => { calls++; return Response.json(completion("ok")); }) as typeof fetch);
  try {
    await assert.rejects(adapter.callModel("glm", "question", signal()), error => {
      assert.ok(error instanceof DebateError); assert.equal(error.code, "transport");
      assert.match(error.message, /control characters/); assert.ok(!error.message.includes("X-Injected")); return true;
    });
    assert.equal(calls, 0);
  } finally { adapter.release(); }
});

test("compatible envelope classifies Cloudflare 520 as provider_unavailable", async () => {
  const adapter = new OpenAICompatibleAdapter(config("http://127.0.0.1:1/v1"), { DEBATE_TEST_API_KEY: key },
    (async () => Response.json({ error: { code: "520", message: "Web server returned an unknown error" } })) as typeof fetch);
  try {
    await assert.rejects(adapter.callModel("glm", "question", signal()), error => {
      assert.ok(error instanceof DebateError); assert.equal(error.code, "provider_unavailable");
      return true;
    });
  } finally { adapter.release(); }
});

test("fallback classifies a redirecting endpoint as a permanent configuration error", async t => {
  const server = await mockCompletions(t, (_request, response) => {
    response.writeHead(302, { location: "http://127.0.0.1:1/elsewhere" }); response.end();
  });
  const adapter = new OpenAICompatibleAdapter(config(server.baseURL), { DEBATE_TEST_API_KEY: key }); t.after(() => adapter.release());
  await assert.rejects(adapter.callModel("glm", "question", signal()), error => {
    assert.ok(error instanceof DebateError); assert.equal(error.code, "transport");
    assert.match(error.message, /redirect/); return true;
  });
});

test("debate recovers after one interrupted HTTP-200 body, then completes with validated proposer and challenger replies", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const requests: { messages: { content: string }[] }[] = [];
  const responses = [interruptedBody(200), Response.json(completion(reply(false))), Response.json(completion(reply(true)))];
  let calls = 0;
  const adapter = new OpenAICompatibleAdapter(config("http://127.0.0.1:1/v1"), { DEBATE_TEST_API_KEY: key },
    (async (_url, init) => { requests.push(JSON.parse(init!.body as string)); return responses[calls++]; }) as typeof fetch);
  t.after(() => adapter.release());
  const result = runDebate({ question: "test", maxRounds: 1, first: "glm", callTimeoutMs: 2000, totalTimeoutMs: 30_000, callModel: adapter.callModel });
  for (let i = 0; i < 40; i++) { await new Promise(resolve => setImmediate(resolve)); t.mock.timers.tick(250); }
  const r = await result;
  assert.equal(r.status, "converged"); assert.equal(calls, 3);
  assert.equal(r.answer, "A tested answer"); assert.equal(r.turns[1].parsed?.agrees_with_current_answer, true);
  assert.equal(r.turns[0].attempts[0].errorCode, "provider_unavailable");
  assert.equal(r.turns[0].attempts[1].kind, "provider_retry");
  assert.deepEqual(requests[1].messages, requests[0].messages);
});

test("repeated interrupted bodies exhaust the shared provider retry budget after three dispatches, without recording agreement", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const adapter = new OpenAICompatibleAdapter(config("http://127.0.0.1:1/v1"), { DEBATE_TEST_API_KEY: key },
    (async () => { calls++; return interruptedBody(200); }) as typeof fetch);
  t.after(() => adapter.release());
  const events: any[] = [];
  const result = runDebate({ question: "test", maxRounds: 1, first: "glm", callTimeoutMs: 2000, totalTimeoutMs: 30_000, callModel: adapter.callModel, onEvent: e => events.push(e) });
  for (let i = 0; i < 40; i++) { await new Promise(resolve => setImmediate(resolve)); t.mock.timers.tick(250); }
  const r = await result;
  assert.equal(r.status, "error"); assert.equal(calls, 3);
  assert.equal(r.failure?.code, "provider_unavailable"); assert.equal(r.failure?.attempts, 3);
  assert.deepEqual(r.turns[0].attempts.map(a => a.kind), ["initial", "provider_retry", "provider_retry"]);
  assert.deepEqual(events.filter(e => e.type === "retry").map(e => e.reason), ["provider_unavailable", "provider_unavailable"]);
  assert.equal(r.stopChecks.length, 0); assert.equal(r.contributions?.winner, "undetermined");
});

test("HTTP 401 with an already-errored body preserves transport classification and the safe HTTP-401 diagnosis", async () => {
  const adapter = new OpenAICompatibleAdapter(config("http://127.0.0.1:1/v1"), { DEBATE_TEST_API_KEY: key },
    (async () => interruptedBody(401)) as typeof fetch);
  try {
    await assert.rejects(adapter.callModel("glm", "question", signal()), error => {
      assert.ok(error instanceof DebateError); assert.equal(error.code, "transport");
      assert.match(error.message, /HTTP 401/);
      assert.match(error.message, /Check endpoint, credentials, and model configuration/);
      assert.doesNotMatch(error.message, /network request failed/); return true;
    });
  } finally { adapter.release(); }
});

test("HTTP 404 with an already-errored body preserves transport classification and the safe HTTP-404 diagnosis", async () => {
  const adapter = new OpenAICompatibleAdapter(config("http://127.0.0.1:1/v1"), { DEBATE_TEST_API_KEY: key },
    (async () => interruptedBody(404)) as typeof fetch);
  try {
    await assert.rejects(adapter.callModel("glm", "question", signal()), error => {
      assert.ok(error instanceof DebateError); assert.equal(error.code, "transport");
      assert.match(error.message, /HTTP 404/);
      assert.match(error.message, /Check endpoint, credentials, and model configuration/);
      assert.doesNotMatch(error.message, /network request failed/); return true;
    });
  } finally { adapter.release(); }
});

test("debate receiving HTTP 401 with an errored body dispatches once and schedules no provider retry", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const adapter = new OpenAICompatibleAdapter(config("http://127.0.0.1:1/v1"), { DEBATE_TEST_API_KEY: key },
    (async () => { calls++; return interruptedBody(401); }) as typeof fetch);
  t.after(() => adapter.release());
  const events: any[] = [];
  const result = runDebate({ question: "test", maxRounds: 1, first: "glm", callTimeoutMs: 2000, totalTimeoutMs: 30_000, callModel: adapter.callModel, onEvent: e => events.push(e) });
  for (let i = 0; i < 40; i++) { await new Promise(resolve => setImmediate(resolve)); t.mock.timers.tick(250); }
  const r = await result;
  assert.equal(r.status, "error"); assert.equal(calls, 1);
  assert.equal(events.filter(e => e.type === "retry").length, 0);
  assert.equal(r.failure?.code, "transport"); assert.equal(r.turns[0].attempts.length, 1);
  assert.match(r.reason, /HTTP 401/);
});
