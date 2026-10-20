import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenCodeAdapter, type OpenCodeClient } from "../src/adapters/opencode.ts";
import { defaults } from "../src/config.ts";
import { DebateError } from "../src/core/types.ts";

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
for (const patch of [{ onlyReasoning: true }, { finish: "length" }, { outcome: "failed" }, { modelChanged: true }]) {
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
  const { retryAfterMs } = await import("../src/adapters/opencode.ts");
  assert.equal(retryAfterMs("3"), 3000);
  assert.equal(retryAfterMs("Thu, 01 Jan 1970 00:00:02 GMT", 1000), 1000);
  assert.equal(retryAfterMs("nonsense"), undefined);
});

test("server-normalized default variant matches an omitted configured variant", async () => {
  const { adapter, change } = setup(); change({ normalizeDefaultVariant: true });
  const reply = await adapter.callModel("glm", "test", new AbortController().signal);
  assert.match(reply.text, /reply 1/);
});
