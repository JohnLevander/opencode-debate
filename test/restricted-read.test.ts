import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, symlink, unlink } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "@opencode/plugin";
import { RestrictedRead, registerToolIsolation } from "../src/restricted-read.ts";
import { EMPTY_READ_NOTICE } from "../src/prompts.ts";
import { OpenCodeAdapter } from "../src/adapters/opencode.ts";
import { defaults, loadConfig } from "../src/config.ts";
import { fakeClient } from "./helpers/fake.ts";

async function fixture() {
  await mkdir(".test-runtime", { recursive: true });
  const root = await mkdtemp(path.resolve(".test-runtime/read-policy-")); const file = path.join(root, "empty.txt");
  await writeFile(file, ""); return { root, file };
}

test("restricted read accepts only the empty file and rejects other tools, paths and directories", async () => {
  const { root, file } = await fixture(); const policy = await RestrictedRead.create(root, file);
  await policy.assertCall("read", { path: file }); await policy.assertCall("read", { path: "empty.txt" });
  for (const [tool, input] of [["shell", { path: file }], ["read", { path: root }], ["read", { path: "canary.txt" }],
    ["read", { path: "../canary.txt" }], ["read", {}], ["read", { path: 1 }], ["read", null], ["debate", { path: file }]] as const) {
    await assert.rejects(policy.assertCall(tool, input), /restricted/);
  }
});

test("restricted read rejects changed content and symlink replacement", async () => {
  const { root, file } = await fixture(); const policy = await RestrictedRead.create(root, file);
  await writeFile(file, "must not reach a debater"); await assert.rejects(policy.assertCall("read", { path: file }), /must remain an empty/);
  const target = path.join(root, "target.txt"); await writeFile(target, ""); await unlink(file); await symlink(target, file);
  await assert.rejects(policy.assertCall("read", { path: file }), /must remain an empty/);
  await assert.rejects(RestrictedRead.create(root, file), /not a symlink/);
});

test("restricted read refuses native AGENTS.md discovery side effects", async () => {
  const { root, file } = await fixture(); const policy = await RestrictedRead.create(root, file);
  await writeFile(path.join(root, "AGENTS.md"), "Instruction text must not be injected by read");
  await assert.rejects(policy.verify(), /nearby AGENTS.md/);
});

test("isolation hooks keep only genuine read and reject executions after cleanup", async () => {
  const { root, file } = await fixture(); const policy = await RestrictedRead.create(root, file);
  const sessions = new Set(["child"]); const reads = new Map([["child", policy]]); const hooks: Record<string, Function> = {};
  const ctx = { session: { hook: async (name: string, fn: Function) => { hooks[name] = fn; } },
    tool: { hook: async (name: string, fn: Function) => { hooks[name] = fn; } } } as unknown as Plugin.Context;
  await registerToolIsolation(ctx, sessions, reads);
  const nativeRead = { description: "Native read", input: {} };
  const event = { agent: "debater", sessionID: "child", tools: { read: nativeRead, shell: {}, debate: {}, mcp_custom: {} }, system: [] as any[] };
  await hooks.context(event); assert.deepEqual(event.tools, { read: nativeRead }); assert.equal(event.tools.read, nativeRead);
  assert.equal(event.system[0].text, EMPTY_READ_NOTICE);
  await hooks["execute.before"]({ agent: "debater", sessionID: "child", tool: "read", input: { path: file } });
  await assert.rejects(hooks["execute.before"]({ agent: "debater", sessionID: "child", tool: "shell", input: { path: file } }));
  const parent = { agent: "build", sessionID: "parent", tools: { shell: {} }, system: [] };
  await hooks.context(parent); assert.deepEqual(parent.tools, { shell: {} });
  reads.delete("child"); await hooks.context(event); assert.deepEqual(event.tools, {});
  await assert.rejects(hooks["execute.before"]({ agent: "debater", sessionID: "child", tool: "read", input: { path: file } }), /disabled/);
});

test("compatibility fails clearly when native read is unavailable", async () => {
  const { root, file } = await fixture(); const policy = await RestrictedRead.create(root, file); let hook!: Function;
  const ctx = { session: { hook: async (_: string, fn: Function) => { hook = fn; } }, tool: { hook: async () => {} } } as unknown as Plugin.Context;
  await registerToolIsolation(ctx, new Set(), new Map([["child", policy]]));
  await assert.rejects(hook({ sessionID: "child", agent: "debater", tools: { shell: {} }, system: [] }), /built-in read tool.*unavailable/);
});

test("adapter scopes compatibility permissions to both retained children and clears runtime grants", async () => {
  const cfg = defaults(); cfg.readCompatibility = true;
  const fake = fakeClient(); const owned = new Set<string>(); const reads = new Map<string, RestrictedRead>();
  const adapter = new OpenCodeAdapter(fake.client, cfg, "parent", "question", owned, new Map(), reads);
  adapter.setAssignment({ proposer: "deepseek", challenger: "glm" }); await adapter.callModel("deepseek", "question", new AbortController().signal);
  assert.equal(reads.size, 2);
  for (const child of fake.created) {
    const file = reads.get(child.id)!.file;
    assert.ok(child.permissions.some((r: any) => r.action === "read" && r.resource === file && r.effect === "allow"));
    assert.deepEqual(child.permissions[0], { action: "*", resource: "*", effect: "deny" });
    assert.ok(child.permissions.filter((r: any) => r.effect === "allow").every((r: any) => ["read", "external_directory"].includes(r.action)));
    assert.equal(adapter.sessions.find(s => s.id === child.id)!.readCompatibilityFile, file);
  }
  adapter.release(); assert.equal(reads.size, 0); assert.equal(owned.size, 0);
});

test("compatibility defaults off and boolean env overrides are validated", async () => {
  const { root } = await fixture();
  assert.equal(defaults().readCompatibility, false);
  const cfg = await loadConfig(root, root, { XDG_CONFIG_HOME: root, OPENCODE_DEBATE_READ_COMPATIBILITY: "true" });
  assert.equal(cfg.readCompatibility, true);
  await assert.rejects(loadConfig(root, root, { XDG_CONFIG_HOME: root, OPENCODE_DEBATE_READ_COMPATIBILITY: "yes" }), /must be true or false/);
});
