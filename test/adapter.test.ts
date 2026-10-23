import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenCodeAdapter, type OpenCodeClient } from "../src/adapters/opencode.ts";
import { providerFailureCode } from "../src/adapters/http.ts";
import { defaults } from "../src/config.ts";
import { DebateError } from "../src/core/types.ts";
import { runDebate } from "../src/core/debate.ts";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ClientError } from "@opencode/client";
import { RestrictedRead } from "../src/restricted-read.ts";
import { tempRoot } from "./helpers/temp.ts";

const tick = () => new Promise(resolve => setImmediate(resolve));
import { fakeClient } from "./helpers/fake.ts";

function setup(config = defaults()) {
  const fake = fakeClient(); const owned = new Set<string>();
  const adapter = new OpenCodeAdapter(fake.client, config, "parent", "question-slug", owned);
  adapter.setAssignment({ proposer: "deepseek", challenger: "glm" });
  return { ...fake, adapter, owned };
}
test("creates exactly two model-selected children, retains sessions and separates text/reasoning", async () => {
  const { adapter, created, prompts, owned, interrupts } = setup();
  const response = await adapter.callModel("glm", "new turn only", new AbortController().signal);
  assert.deepEqual(response, { text: "reply 1\n\nfinal text", reasoning: "secret reasoning" });
  assert.equal(created.length, 2); assert.equal(created[0].parentID, "parent"); assert.equal(created[0].agent, "debater");
  assert.equal(created[0].title, "debate: question-slug | GLM (challenger)"); assert.equal(created[1].title, "debate: question-slug | DeepSeek (proposer)");
  assert.deepEqual(created[0].permissions, [{ action: "*", resource: "*", effect: "deny" }]);
  assert.equal(prompts[0].text, "new turn only"); assert.equal(prompts[0].model, undefined);
  await adapter.callModel("glm", "second turn", new AbortController().signal);
  assert.equal(created.length, 2); assert.equal(prompts[1].sessionID, created[0].id); assert.equal(owned.size, 2);
  adapter.release(); assert.equal(owned.size, 0); assert.equal(interrupts.length, 0);
});
test("missing model fails before creating children and names fallback config", async () => {
  const config = defaults(); config.models.glm.modelID = "missing-promo";
  const { adapter, created } = setup(config);
  await assert.rejects(adapter.callModel("glm", "test", new AbortController().signal), /missing-promo.*openai-compatible/);
  assert.equal(created.length, 0);
});
test("variant is validated and passed at creation", async () => {
  const config = defaults(); config.models.glm.variant = "low";
  const { adapter, created } = setup(config); await adapter.callModel("glm", "test", new AbortController().signal);
  assert.equal(created[0].model.variant, "low");
  config.models.glm.variant = "invalid";
  await assert.rejects(setup(config).adapter.callModel("glm", "test", new AbortController().signal), /Variant invalid/);
});
test("a reasoning-only reply returns empty text with its reasoning so the engine can repair and log it", async () => {
  const { adapter, change } = setup(); change({ onlyReasoning: true });
  assert.deepEqual(await adapter.callModel("glm", "test", new AbortController().signal), { text: "", reasoning: "secret reasoning" });
});
for (const patch of [{ finish: "length" }, { outcome: "failed" }, { modelChanged: true }]) {
  test(`rejects incomplete/error or changed-model responses: ${JSON.stringify(patch)}`, async () => {
    const { adapter, change } = setup(); change(patch);
    await assert.rejects(adapter.callModel("glm", "test", new AbortController().signal));
  });
}
test("provider 429 is returned as a typed engine rate limit", async () => {
  const { adapter, change } = setup(); change({ assistantError: { type: "api", status: 429, message: "Slow down" }, outcome: "failed" });
  await assert.rejects(adapter.callModel("glm", "test", new AbortController().signal), e => e instanceof DebateError && e.code === "rate_limit");
});
test("abort promptly interrupts even though mock wait ignores request options", async () => {
  const { adapter, change, prompts, interrupts } = setup();
  let finishWait!: () => void;
  change({ onWait: async () => { if (prompts.length) await new Promise<void>(resolve => { finishWait = resolve; }); } });
  const controller = new AbortController();
  const call = adapter.callModel("glm", "test", controller.signal);
  while (!finishWait) await tick();
  controller.abort(new DebateError("call_timeout", "Call timeout"));
  await assert.rejects(call, /Call timeout/); assert.ok(interrupts.includes("child-0"));
  finishWait(); await tick(); await adapter.cancelAll(); assert.ok(interrupts.includes("child-1"));
});
test("late prompt admission is interrupted before the retry may enter", async () => {
  const { adapter, change, prompts, interrupts } = setup();
  let finishAdmission!: () => void;
  change({ onPrompt: async () => { if (prompts.length === 1) await new Promise<void>(resolve => { finishAdmission = resolve; }); } });
  const controller = new AbortController(); const first = adapter.callModel("glm", "first", controller.signal);
  while (!finishAdmission) await tick();
  controller.abort(new DebateError("call_timeout", "Call timeout")); await assert.rejects(first, /timeout/);
  const second = adapter.callModel("glm", "retry", new AbortController().signal);
  await tick(); assert.equal(prompts.length, 1);
  finishAdmission(); const response = await second;
  assert.ok(interrupts.length >= 2); assert.equal(prompts.length, 2); assert.match(response.text, /reply 2/);
});
test("child arriving after close is retained for inspection and interrupted", async () => {
  const { adapter, raw, created, interrupts } = setup();
  let finishCreate!: () => void; const create = raw.session.create;
  raw.session.create = async input => { await new Promise<void>(resolve => { finishCreate = resolve; }); return create(input); };
  const controller = new AbortController(); const work = adapter.callModel("glm", "test", controller.signal);
  while (!finishCreate) await tick(); controller.abort(); await assert.rejects(work);
  await adapter.cancelAll(); finishCreate(); await tick(); await tick();
  assert.equal(created.length, 1); assert.ok(interrupts.includes(created[0].id));
});

test("Retry-After accepts seconds and dates but ignores invalid values", async () => {
  const { retryAfterMs } = await import("../src/adapters/http.ts");
  assert.equal(retryAfterMs("3"), 3000);
  assert.equal(retryAfterMs("Thu, 01 Jan 1970 00:00:02 GMT", 1000), 1000);
  assert.equal(retryAfterMs("nonsense"), undefined);
  assert.equal(retryAfterMs("-1"), undefined);
  assert.equal(retryAfterMs("1e308"), undefined);
  assert.equal(retryAfterMs("Infinity"), undefined);
});

test("Retry-After accepts only plain non-negative decimal seconds", async () => {
  const { retryAfterMs } = await import("../src/adapters/http.ts");
  assert.equal(retryAfterMs(" "), undefined);
  assert.equal(retryAfterMs("0x10"), undefined);
  assert.equal(retryAfterMs("1e3"), undefined);
  assert.equal(retryAfterMs("+3"), undefined);
  assert.equal(retryAfterMs("12"), 12000);
});

test("server-normalized default variant matches an omitted configured variant", async () => {
  const { adapter, change } = setup(); change({ normalizeDefaultVariant: true });
  const reply = await adapter.callModel("glm", "test", new AbortController().signal);
  assert.match(reply.text, /reply 1/);
});


test("native free-tier rejection explains the tool-free compatibility blocker without asking for a paid key", async () => {
  const { adapter, change } = setup();
  change({ assistantError: { type: "provider.auth", message: "OpenCode's free tier can only be used from within OpenCode. Download it at https://opencode.ai and keep building." }, outcome: "failed" });
  await assert.rejects(adapter.callModel("deepseek", "question", new AbortController().signal), error => {
    assert.ok(error instanceof DebateError); assert.equal(error.code, "transport");
    assert.match(error.message, /provider.auth: OpenCode's free tier/);
    assert.match(error.message, /already ran inside an OpenCode child session/);
    assert.match(error.message, /all tools disabled/);
    assert.match(error.message, /does not establish that a paid provider or OpenRouter API key is needed/);
    assert.match(error.message, /changing tool permissions requires approval/);
    return true;
  });
});

test("other authentication errors keep their original diagnosis", async () => {
  const { adapter, change } = setup();
  change({ assistantError: { type: "provider.auth", message: "Expired Console credential", status: 401 }, outcome: "failed" });
  await assert.rejects(adapter.callModel("glm", "question", new AbortController().signal), error => {
    assert.ok(error instanceof DebateError); assert.equal(error.message, "provider.auth: Expired Console credential"); return true;
  });
});

for (const entry of [
  { error: { type: "provider.rate-limit", message: "Upstream request failed: Endpoint is unavailable." }, code: "provider_unavailable" },
  { error: { type: "provider.rate-limit", message: "Upstream request failed: Endpoint is unavailable.", status: 429 }, code: "provider_unavailable" },
  { error: { type: "provider.error", message: "Temporarily offline", status: 503 }, code: "provider_unavailable" },
  { error: { type: "provider.rate-limit", message: "Quota exceeded", status: 429 }, code: "rate_limit" },
  { error: { type: "provider.auth", message: "Endpoint is unavailable", status: 401 }, code: "transport" },
  { error: { type: "provider.error", message: "Model not found", status: 404 }, code: "transport" },
] as const) {
  test(`native errors classify ${JSON.stringify(entry.error)} as ${entry.code}`, async () => {
    const { adapter, change } = setup();
    change({ assistantError: entry.error, outcome: "failed" });
    await assert.rejects(adapter.callModel("glm", "question", new AbortController().signal), error => {
      assert.ok(error instanceof DebateError); assert.equal(error.code, entry.code);
      assert.ok(error.message.includes(entry.error.message)); return true;
    });
  });
}

test("HTTP 400 with an outage phrase remains non-retryable transport", () => {
  assert.equal(providerFailureCode(400, "provider.error", "Upstream request failed: Endpoint is unavailable."), "transport");
  assert.equal(providerFailureCode(400, "service_unavailable", "provider detail"), "transport");
});

test("HTTP 404 with an outage phrase remains non-retryable transport", () => {
  assert.equal(providerFailureCode(404, "provider.error", "Endpoint is unavailable"), "transport");
  assert.equal(providerFailureCode(404, "overloaded", "provider detail"), "transport");
});

test("permanent 4xx classifications ignore rate-limit envelope types", () => {
  assert.equal(providerFailureCode(400, "rate_limit_exceeded", "provider detail"), "transport");
  assert.equal(providerFailureCode(404, "too_many_requests", "provider detail"), "transport");
});

test("Anthropic-style overload signals classify as provider_unavailable", () => {
  assert.equal(providerFailureCode(529, "", ""), "provider_unavailable");
  assert.equal(providerFailureCode(undefined, "overloaded_error", ""), "provider_unavailable");
  assert.equal(providerFailureCode(undefined, "", "The API is temporarily overloaded"), "provider_unavailable");
});

test("auth envelope types outrank transient statuses", () => {
  assert.equal(providerFailureCode(503, "invalid_api_key", "provider detail"), "transport");
  assert.equal(providerFailureCode(429, "invalid_api_key", "provider detail"), "transport");
});

test("Cloudflare origin failures 520-524 classify as provider_unavailable", () => {
  for (const status of [520, 521, 522, 523, 524]) assert.equal(providerFailureCode(status, "", ""), "provider_unavailable");
  // Deliberately permanent 5xx stay permanent.
  assert.equal(providerFailureCode(501, "", ""), "transport");
  assert.equal(providerFailureCode(505, "", ""), "transport");
});

test("generic overload wording classifies provider_unavailable without a known subject", () => {
  assert.equal(providerFailureCode(undefined, "", "The requested model is temporarily unavailable"), "provider_unavailable");
  assert.equal(providerFailureCode(undefined, "", "Provider is currently overloaded"), "provider_unavailable");
  assert.equal(providerFailureCode(429, "", "The model is overloaded"), "provider_unavailable");
  // Wording alone cannot rescue a permanent status.
  assert.equal(providerFailureCode(404, "", "The model is overloaded"), "transport");
});

test("native OpenCode adapter preserves a structured 404 containing an outage phrase", async () => {
  const { adapter, change } = setup();
  change({ assistantError: { type: "provider.error", message: "Upstream request failed: Endpoint is unavailable.", status: 404 }, outcome: "failed" });
  await assert.rejects(adapter.callModel("glm", "question", new AbortController().signal), error => {
    assert.ok(error instanceof DebateError); assert.equal(error.code, "transport");
    assert.equal(error.message, "provider.error: Upstream request failed: Endpoint is unavailable.");
    return true;
  });
});

test("native adapter recovers from a transient child-creation failure without duplicating children", async () => {
  const fake = fakeClient(); let failures = 0;
  const original = fake.raw.session.create;
  fake.raw.session.create = async (input: any) => { if (++failures === 2) throw new TypeError("socket hang up"); return original(input); };
  const owned = new Set<string>();
  const adapter = new OpenCodeAdapter(fake.client, defaults(), "parent", "question-slug", owned);
  adapter.setAssignment({ proposer: "deepseek", challenger: "glm" });
  await assert.rejects(adapter.callModel("glm", "question", new AbortController().signal), error => {
    assert.ok(error instanceof DebateError); assert.equal(error.code, "provider_unavailable"); return true;
  });
  const response = await adapter.callModel("glm", "question", new AbortController().signal);
  assert.match(response.text, /reply 1/);
  assert.equal(fake.created.length, 2); assert.equal(owned.size, 2);
});

test("transient SDK failures during prompting classify as retryable provider_unavailable", async () => {
  const fake = fakeClient(); let failures = 0;
  const original = fake.raw.session.prompt;
  fake.raw.session.prompt = async (input: any) => { if (++failures === 1) throw new TypeError("fetch failed"); return original(input); };
  const adapter = new OpenCodeAdapter(fake.client, defaults(), "parent", "question-slug", new Set());
  adapter.setAssignment({ proposer: "glm", challenger: "deepseek" });
  await assert.rejects(adapter.callModel("glm", "question", new AbortController().signal), error => {
    assert.ok(error instanceof DebateError); assert.equal(error.code, "provider_unavailable"); return true;
  });
});

test("a bare caller abort stays an abort, not a retryable provider failure", async () => {
  const fake = fakeClient();
  let finishCreate!: () => void;
  const original = fake.raw.session.create;
  fake.raw.session.create = async (input: any) => { await new Promise<void>(resolve => { finishCreate = resolve; }); return original(input); };
  const adapter = new OpenCodeAdapter(fake.client, defaults(), "parent", "question-slug", new Set());
  adapter.setAssignment({ proposer: "glm", challenger: "deepseek" });
  const controller = new AbortController();
  const pending = adapter.callModel("glm", "question", controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, error => !(error instanceof DebateError && error.code === "provider_unavailable"));
  finishCreate();
});

test("release clears captured retry hints for retained child sessions", async () => {
  const fake = fakeClient(); const hints = new Map<string, number>();
  const adapter = new OpenCodeAdapter(fake.client, defaults(), "parent", "question-slug", new Set(), hints);
  adapter.setAssignment({ proposer: "glm", challenger: "deepseek" });
  await adapter.callModel("glm", "test", new AbortController().signal);
  for (const child of fake.created) hints.set(child.id, 5000);
  assert.equal(hints.size, 2);
  adapter.release();
  assert.equal(hints.size, 0);
});

test("native initialization failures are permanent single-dispatch errors in the engine", async () => {
  const events: any[] = [];
  const fake = fakeClient(); fake.raw.model.list = async () => ({ data: [] });
  const adapter = new OpenCodeAdapter(fake.client, defaults(), "parent", "q", new Set());
  adapter.setAssignment({ proposer: "glm", challenger: "deepseek" });
  const r = await runDebate({ question: "q", first: "glm", maxRounds: 1, callTimeoutMs: 1000, totalTimeoutMs: 5000, callModel: adapter.callModel, onEvent: e => events.push(e) });
  assert.equal(r.status, "error"); assert.equal(r.failure?.code, "transport");
  assert.equal(r.turns[0].attempts.length, 1); assert.equal(events.filter(e => e.type === "retry").length, 0);
});
test("repeated native initialization attempts keep failing without creating children", async () => {
  const fake = fakeClient(); fake.raw.model.list = async () => ({ data: [] });
  const adapter = new OpenCodeAdapter(fake.client, defaults(), "parent", "q", new Set());
  adapter.setAssignment({ proposer: "glm", challenger: "deepseek" });
  for (let i = 0; i < 2; i++) await assert.rejects(adapter.callModel("glm", "q", new AbortController().signal), /unavailable.*openai-compatible/s);
  assert.equal(fake.created.length, 0);
});
test("an unavailable variant is also a permanent single-dispatch failure", async () => {
  const config = defaults(); config.models.glm.variant = "missing";
  const fake = fakeClient(); const adapter = new OpenCodeAdapter(fake.client, config, "parent", "q", new Set());
  adapter.setAssignment({ proposer: "glm", challenger: "deepseek" });
  const r = await runDebate({ question: "q", first: "glm", maxRounds: 1, callTimeoutMs: 1000, totalTimeoutMs: 5000, callModel: adapter.callModel });
  assert.equal(r.status, "error"); assert.equal(r.failure?.code, "transport"); assert.equal(r.turns[0].attempts.length, 1);
});

function withIdleError(error: any) {
  const fake = fakeClient();
  const original = fake.raw.session.context;
  fake.raw.session.context = async ({ sessionID }: any) => {
    const messages = await original({ sessionID });
    return messages.some((m: any) => m.type === "assistant") ? [...messages, { type: "idle", error }] : messages;
  };
  return fake;
}
test("an idle-message capacity error classifies as provider_unavailable", async () => {
  const fake = withIdleError({ type: "provider.error", message: "Temporarily offline", status: 503 });
  const adapter = new OpenCodeAdapter(fake.client, defaults(), "parent", "q", new Set());
  adapter.setAssignment({ proposer: "glm", challenger: "deepseek" });
  await assert.rejects(adapter.callModel("glm", "question", new AbortController().signal), e => e instanceof DebateError && e.code === "provider_unavailable");
});
test("an idle-message authentication error classifies as transport", async () => {
  const fake = withIdleError({ type: "provider.auth", message: "Expired credential", status: 401 });
  const adapter = new OpenCodeAdapter(fake.client, defaults(), "parent", "q", new Set());
  adapter.setAssignment({ proposer: "glm", challenger: "deepseek" });
  await assert.rejects(adapter.callModel("glm", "question", new AbortController().signal), e => e instanceof DebateError && e.code === "transport");
});
test("an idle message without an error does not fail the turn", async () => {
  const fake = withIdleError(undefined);
  const adapter = new OpenCodeAdapter(fake.client, defaults(), "parent", "q", new Set());
  adapter.setAssignment({ proposer: "glm", challenger: "deepseek" });
  assert.match((await adapter.callModel("glm", "question", new AbortController().signal)).text, /reply 1/);
});

test("unacknowledged interrupts record interrupted: false with a timestamp", async () => {
  const fake = fakeClient(); fake.raw.session.interrupt = async ({ sessionID }: any) => { fake.interrupts.push(sessionID); return { interrupted: false }; };
  const adapter = new OpenCodeAdapter(fake.client, defaults(), "parent", "q", new Set());
  adapter.setAssignment({ proposer: "glm", challenger: "deepseek" });
  await adapter.callModel("glm", "question", new AbortController().signal);
  await adapter.cancelAll();
  assert.equal(adapter.interruptions.length, 2);
  for (const observation of adapter.interruptions) { assert.equal(observation.interrupted, false); assert.ok(observation.acknowledgedAt! > 0); }
});
test("abort-driven interrupts keep recording the acknowledgement result", async () => {
  const fake = fakeClient(); fake.raw.session.interrupt = async ({ sessionID }: any) => { fake.interrupts.push(sessionID); return { interrupted: false }; };
  fake.change({ onWait: async () => { if (fake.prompts.length) await new Promise<void>(() => {}); } });
  const adapter = new OpenCodeAdapter(fake.client, defaults(), "parent", "q", new Set());
  adapter.setAssignment({ proposer: "glm", challenger: "deepseek" });
  const controller = new AbortController();
  const pending = adapter.callModel("glm", "question", controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(new DebateError("call_timeout", "Call timeout"));
  await assert.rejects(pending, /Call timeout/);
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(adapter.interruptions.some(o => o.interrupted === false));
});
test("interrupt failures are recorded as diagnostics without throwing", async () => {
  const fake = fakeClient(); fake.raw.session.interrupt = async ({ sessionID }: any) => { fake.interrupts.push(sessionID); throw new Error("server unreachable"); };
  const adapter = new OpenCodeAdapter(fake.client, defaults(), "parent", "q", new Set());
  adapter.setAssignment({ proposer: "glm", challenger: "deepseek" });
  await adapter.callModel("glm", "question", new AbortController().signal);
  await adapter.cancelAll();
  assert.equal(adapter.interruptions.length, 2); assert.equal(adapter.diagnostics.length, 2);
  for (const observation of adapter.interruptions) { assert.match(observation.error!, /server unreachable/); assert.equal(observation.acknowledgedAt, undefined); }
});

test("future-dated Retry-After values compute their forward delay", async () => {
  const { retryAfterMs } = await import("../src/adapters/http.ts");
  assert.equal(retryAfterMs("Thu, 01 Jan 1970 00:00:05 GMT", 2000), 3000);
  assert.equal(retryAfterMs("Thu, 01 Jan 1970 00:00:02 GMT", 2000), 0);
});
test("a near-future HTTP-date yields its remaining milliseconds", async () => {
  const { retryAfterMs } = await import("../src/adapters/http.ts");
  // toUTCString truncates milliseconds; align the target to a whole second so the window is deterministic.
  const now = Date.now();
  const target = new Date(Math.ceil((now + 2500) / 1000) * 1000).toUTCString();
  const delay = retryAfterMs(target, now)!;
  assert.ok(delay >= 2500 && delay <= 3500, `delay=${delay}`);
});
test("a far-future HTTP-date stays finite for deadline clamping", async () => {
  const { retryAfterMs } = await import("../src/adapters/http.ts");
  const delay = retryAfterMs("Fri, 01 Jan 2100 00:00:00 GMT", 0);
  assert.ok(typeof delay === "number" && Number.isFinite(delay) && delay > 3e11);
});

test("rate-limit message wording without a type classifies as rate_limit", () => {
  assert.equal(providerFailureCode(undefined, "", "Too many requests; slow down"), "rate_limit");
});
test("quota-exceeded message wording classifies as rate_limit", () => {
  assert.equal(providerFailureCode(undefined, "", "quota exceeded: too many requests for this model"), "rate_limit");
});
test("endpoint_unavailable and upstream_unavailable types classify as outages", () => {
  assert.equal(providerFailureCode(undefined, "endpoint_unavailable", "provider detail"), "provider_unavailable");
  assert.equal(providerFailureCode(undefined, "upstream_unavailable", "provider detail"), "provider_unavailable");
});
test("gateway timeout and bad gateway types classify as outages", () => {
  assert.equal(providerFailureCode(undefined, "gateway_timeout", "provider detail"), "provider_unavailable");
  assert.equal(providerFailureCode(undefined, "bad_gateway", "provider detail"), "provider_unavailable");
});
test("request_timeout stays permanent so client-side timeouts do not loop", () => {
  assert.equal(providerFailureCode(undefined, "request_timeout", "provider detail"), "transport");
});
test("Retry-After tolerates padded plain seconds", async () => {
  const { retryAfterMs } = await import("../src/adapters/http.ts");
  assert.equal(retryAfterMs(" 3 "), 3000);
  assert.equal(retryAfterMs("3\n"), 3000);
});
test("Retry-After tolerates a padded HTTP-date", async () => {
  const { retryAfterMs } = await import("../src/adapters/http.ts");
  assert.equal(retryAfterMs(" Thu, 01 Jan 1970 00:00:02 GMT ", 1000), 1000);
});
test("string rate-limit guidance without a type classifies as rate_limit", () => {
  assert.equal(providerFailureCode(undefined, "", "Rate limit exceeded. Retry in 3 seconds."), "rate_limit");
});
test("a padded zero Retry-After still yields a usable floor hint", async () => {
  const { retryAfterMs } = await import("../src/adapters/http.ts");
  assert.equal(retryAfterMs(" 0 "), 0);
});

test("a real compatibility guard failure preserves its cause and dispatches only once", async t => {
  const root = await tempRoot("guard-error-");
  await mkdir(root, { recursive: true });
  const file = path.join(root, "empty.txt");
  await writeFile(file, ""); await writeFile(path.join(root, "AGENTS.md"), "Fixture instruction file");
  const create = RestrictedRead.create; let checks = 0;
  t.mock.method(RestrictedRead, "create", async (directory: string) => { checks++; return create.call(RestrictedRead, directory, file); });
  const config = defaults(); config.readCompatibility = true;
  const fake = fakeClient();
  const adapter = new OpenCodeAdapter(fake.client, config, "parent", "guard", new Set());
  adapter.setAssignment({ proposer: "glm", challenger: "deepseek" });
  t.after(() => adapter.release());
  const retries: unknown[] = [];
  const result = await runDebate({ question: "q", first: "glm", maxRounds: 1, callTimeoutMs: 1000, totalTimeoutMs: 5000,
    callModel: adapter.callModel, onEvent: event => { if (event.type === "retry") retries.push(event); } });
  assert.equal(result.status, "error"); assert.equal(result.failure?.code, "transport");
  assert.match(result.reason, /Restricted-read compatibility check failed:.*nearby AGENTS\.md/);
  assert.equal(checks, 1); assert.equal(result.turns[0].attempts.length, 1);
  assert.deepEqual(retries, []); assert.equal(fake.created.length, 0);
});

for (const tag of ["UnauthorizedError", "InvalidRequestError", "SessionNotFoundError"]) {
  test(`declared SDK ${tag} is permanent and does not expose its body`, async () => {
    const fake = fakeClient();
    fake.raw.model.list = async () => { throw { _tag: tag, message: "secret-body-should-not-be-logged" }; };
    const adapter = new OpenCodeAdapter(fake.client, defaults(), "parent", "request", new Set());
    adapter.setAssignment({ proposer: "glm", challenger: "deepseek" });
    const result = await runDebate({ question: "q", first: "glm", maxRounds: 1, callTimeoutMs: 1000, totalTimeoutMs: 5000, callModel: adapter.callModel });
    assert.equal(result.failure?.code, "transport"); assert.equal(result.turns[0].attempts.length, 1);
    assert.ok(result.reason.includes(tag)); assert.ok(!JSON.stringify(result).includes("secret-body"));
    assert.equal(fake.created.length, 0);
  });
}

test("SDK connection errors retry while malformed responses and programming errors remain permanent", async () => {
  for (const [failure, code] of [
    [new ClientError("Transport", { cause: new Error("secret-network-detail") }), "provider_unavailable"],
    [new ClientError("UnexpectedStatus", { cause: { status: 503 } }), "provider_unavailable"],
    [new ClientError("UnexpectedStatus", { cause: { status: 404 } }), "transport"],
    [new ClientError("MalformedResponse"), "transport"],
    [new TypeError("Cannot read properties of undefined"), "transport"],
    [new TypeError("Cannot read properties of undefined (reading network)"), "transport"],
    [Object.assign(new Error("invalid argument"), { code: "UND_ERR_INVALID_ARG" }), "transport"],
    [Object.assign(new Error("socket closed"), { code: "UND_ERR_SOCKET" }), "provider_unavailable"],
    [new TypeError("fetch failed"), "provider_unavailable"],
    [Object.assign(new Error("connection failed"), { code: "ECONNREFUSED" }), "provider_unavailable"],
  ] as const) {
    const fake = fakeClient(); fake.raw.model.list = async () => { throw failure; };
    const adapter = new OpenCodeAdapter(fake.client, defaults(), "parent", "request", new Set());
    adapter.setAssignment({ proposer: "glm", challenger: "deepseek" });
    await assert.rejects(adapter.callModel("glm", "q", new AbortController().signal), error => {
      assert.ok(error instanceof DebateError); assert.equal(error.code, code);
      assert.ok(!error.message.includes("secret-network-detail")); return true;
    });
    adapter.release();
  }
});
