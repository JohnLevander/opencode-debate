import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "@opencode/plugin";
import { executeDebate, debateArgs, type DebateShared } from "../src/index.ts";
import { CONTEXT_DIR, MAX_CONTEXT_CHARS, resolveContext } from "../src/context.ts";
import { fakeClient } from "./helpers/fake.ts";
import { tempRoot } from "./helpers/temp.ts";

const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
// Text a retyping model tends to normalize: BOM, CRLF, tabs, trailing spaces, non-ASCII, a long netlist line.
const EXACT = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("- GND: C1.2 R51.2\r\n\tR42 10 kΩ: 1→Q12_E, 2→LVL_N   \n\n- V9: R1.1\n", "utf8")]);

async function project() {
  const root = await tempRoot("context-");
  await mkdir(path.join(root, CONTEXT_DIR), { recursive: true });
  return root;
}
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
const execution = { sessionID: "parent", agent: "build", signal: new AbortController().signal, progress: async () => {} };
const shared = (): DebateShared => ({ owned: new Set(), retryHints: new Map(), restrictedReads: new Map() });
const ctxOf = (fake: ReturnType<typeof fakeClient>, root: string) =>
  ({ ...fake.client, location: { directory: root, project: { directory: root } }, app: { version: "2.0.32" } }) as unknown as Plugin.Context;
async function withLogDir<T>(fn: (logs: string) => Promise<T>): Promise<T> {
  const logs = await tempRoot("context-logs-");
  const previous = process.env.OPENCODE_DEBATE_LOG_DIR, previousConfig = process.env.XDG_CONFIG_HOME;
  process.env.OPENCODE_DEBATE_LOG_DIR = logs; process.env.XDG_CONFIG_HOME = path.join(logs, "no-global-config");
  try { return await fn(logs); }
  finally {
    if (previous === undefined) delete process.env.OPENCODE_DEBATE_LOG_DIR; else process.env.OPENCODE_DEBATE_LOG_DIR = previous;
    if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previousConfig;
  }
}
const journal = async (logs: string) => JSON.parse(await readFile(path.join(logs, (await readdir(logs)).find(f => f.endsWith(".json"))!), "utf8"));

test("context_file delivers the file's exact bytes to the debaters, the journal and the result", async () => withLogDir(async logs => {
  const root = await project(); await writeFile(path.join(root, CONTEXT_DIR, "netlist.txt"), EXACT);
  const fake = debating();
  const output = await executeDebate(ctxOf(fake, root), { question: "test", first: "glm", context_file: "netlist.txt", context_sha256: sha(EXACT).toUpperCase() }, execution, shared());
  const text = EXACT.toString("utf8"); // includes the BOM: TextDecoder runs with ignoreBOM
  assert.equal(text.charCodeAt(0), 0xfeff);
  assert.match(output, /Debate result: converged/);
  assert.ok(fake.prompts[0].text.includes(`CONTEXT:\n${text}`), "opening prompt carries the exact text");
  const log = await journal(logs);
  assert.equal(log.context, text);
  assert.deepEqual(log.contextSource, { kind: "file", file: path.join(CONTEXT_DIR, "netlist.txt"), bytes: EXACT.length, sha256: sha(EXACT), expectedSha256: sha(EXACT) });
  assert.ok(output.includes(`Context: ${EXACT.length} bytes, SHA-256 ${sha(EXACT)}, read from ${path.join(CONTEXT_DIR, "netlist.txt")} (exact file bytes); matches the requested context_sha256.`));
}));

test("an inline context whose hash differs is refused before any child session or prompt", async () => withLogDir(async logs => {
  const root = await project(); const fake = debating();
  const retyped = EXACT.toString("utf8").replace("R51.2", "");
  const output = await executeDebate(ctxOf(fake, root), { question: "test", first: "glm", context: retyped, context_sha256: sha(EXACT) }, execution, shared());
  assert.match(output, /Debate result: error/); assert.match(output, /Context SHA-256 mismatch/);
  assert.equal(fake.created.length, 0); assert.equal(fake.prompts.length, 0);
  const log = await journal(logs);
  assert.equal(log.status, "error"); assert.match(log.contextError, /mismatch/); assert.equal(log.context, retyped); assert.equal(log.sessions.length, 0);
}));

test("an inline context with a matching hash runs and is labeled as inline", async () => withLogDir(async () => {
  const root = await project(); const fake = debating(); const context = "exact inline text\n";
  const output = await executeDebate(ctxOf(fake, root), { question: "test", first: "glm", context, context_sha256: sha(context) }, execution, shared());
  assert.match(output, /Debate result: converged/);
  assert.match(output, /inline \(as passed by the calling model\); matches the requested context_sha256/);
}));

test("an inline context without a hash still runs and reports its own hash", async () => withLogDir(async () => {
  const root = await project(); const context = "plain\n";
  const output = await executeDebate(ctxOf(debating(), root), { question: "test", first: "glm", context }, execution, shared());
  assert.ok(output.includes(`Context: 6 bytes, SHA-256 ${sha(context)}, inline (as passed by the calling model).`));
}));

test("a debate without context has no context line", async () => withLogDir(async () => {
  const output = await executeDebate(ctxOf(debating(), await project()), { question: "test", first: "glm" }, execution, shared());
  assert.match(output, /Debate result: converged/); assert.ok(!output.includes("Context:"));
}));

test("context and context_file together are refused before any model call", async () => withLogDir(async () => {
  const root = await project(); await writeFile(path.join(root, CONTEXT_DIR, "a.txt"), "a");
  const fake = debating();
  const output = await executeDebate(ctxOf(fake, root), { question: "test", first: "glm", context: "a", context_file: "a.txt" }, execution, shared());
  assert.match(output, /Pass either context or context_file, not both/); assert.equal(fake.created.length, 0);
}));

test("context_sha256 without any context is refused", async () => withLogDir(async () => {
  const fake = debating();
  const output = await executeDebate(ctxOf(fake, await project()), { question: "test", first: "glm", context_sha256: sha("x") }, execution, shared());
  assert.match(output, /context_sha256 was given without context or context_file/); assert.equal(fake.prompts.length, 0);
}));

test("context_file cannot read outside the context directory", async () => {
  const root = await project();
  await writeFile(path.join(root, "secret.txt"), "do not send");
  await writeFile(path.join(root, ".opencode", "outside.txt"), "do not send");
  await symlink(path.join(root, "secret.txt"), path.join(root, CONTEXT_DIR, "link.txt"));
  await assert.rejects(resolveContext(root, { context_file: "../outside.txt" }), /must stay inside/);
  await assert.rejects(resolveContext(root, { context_file: "../../secret.txt" }), /must stay inside/);
  await assert.rejects(resolveContext(root, { context_file: path.join(root, "secret.txt") }), /relative/);
  await assert.rejects(resolveContext(root, { context_file: "link.txt" }), /must stay inside/);
  await assert.rejects(resolveContext(root, { context_file: "." }), /must stay inside/);
});

test("a symlinked context directory is followed only within its real location", async () => {
  const root = await project(); const real = await tempRoot("context-real-");
  await writeFile(path.join(real, "inside.txt"), "ok");
  const other = await tempRoot("context-linked-"); await mkdir(path.join(other, ".opencode"), { recursive: true });
  await symlink(real, path.join(other, CONTEXT_DIR));
  assert.equal((await resolveContext(other, { context_file: "inside.txt" })).context, "ok");
  await assert.rejects(resolveContext(other, { context_file: "../" + path.basename(root) }), /not found|must stay inside/);
});

test("context_file requires the context directory and an existing regular file", async () => {
  const bare = await tempRoot("context-bare-");
  await assert.rejects(resolveContext(bare, { context_file: "a.txt" }), /requires the directory/);
  const root = await project();
  await assert.rejects(resolveContext(root, { context_file: "missing.txt" }), /not found/);
  await mkdir(path.join(root, CONTEXT_DIR, "sub"));
  await assert.rejects(resolveContext(root, { context_file: "sub" }), /not a regular file/);
  execFileSync("mkfifo", [path.join(root, CONTEXT_DIR, "pipe")]);
  await assert.rejects(resolveContext(root, { context_file: "pipe" }), /not a regular file/); // must not block on the FIFO
});

test("context_file rejects invalid UTF-8 and oversized files", async () => {
  const root = await project(); const dir = path.join(root, CONTEXT_DIR);
  await writeFile(path.join(dir, "bad.txt"), Buffer.from([0x61, 0xff, 0x62]));
  await assert.rejects(resolveContext(root, { context_file: "bad.txt" }), /not valid UTF-8/);
  await writeFile(path.join(dir, "long.txt"), "c".repeat(MAX_CONTEXT_CHARS + 1));
  await assert.rejects(resolveContext(root, { context_file: "long.txt" }), /exceeds 300000 characters/);
  await writeFile(path.join(dir, "huge.txt"), Buffer.alloc(MAX_CONTEXT_CHARS * 4 + 1, 0x61));
  await assert.rejects(resolveContext(root, { context_file: "huge.txt" }), /larger than/);
  await writeFile(path.join(dir, "max.txt"), "c".repeat(MAX_CONTEXT_CHARS));
  assert.equal((await resolveContext(root, { context_file: "max.txt" })).context!.length, MAX_CONTEXT_CHARS);
});

test("a file's hash is over its raw bytes and a subdirectory path is allowed", async () => {
  const root = await project(); await mkdir(path.join(root, CONTEXT_DIR, "q14"));
  await writeFile(path.join(root, CONTEXT_DIR, "q14", "ctx.txt"), EXACT);
  const { context, source } = await resolveContext(root, { context_file: "q14/ctx.txt", context_sha256: sha(EXACT) });
  assert.equal(Buffer.from(context!, "utf8").equals(EXACT), true);
  assert.equal(source!.sha256, sha(EXACT)); assert.equal(source!.file, path.join(CONTEXT_DIR, "q14", "ctx.txt"));
  await assert.rejects(resolveContext(root, { context_file: "q14/ctx.txt", context_sha256: sha("other") }), /mismatch.*from \.opencode/);
});

test("the argument schema validates context_sha256 and bounds context_file", () => {
  assert.equal(debateArgs.safeParse({ question: "q", context_sha256: "a".repeat(64) }).success, true);
  assert.equal(debateArgs.safeParse({ question: "q", context_sha256: "g".repeat(64) }).success, false);
  assert.equal(debateArgs.safeParse({ question: "q", context_sha256: "a".repeat(63) }).success, false);
  assert.equal(debateArgs.safeParse({ question: "q", context_file: "" }).success, false);
  assert.equal(debateArgs.safeParse({ question: "q", context_file: "x".repeat(4097) }).success, false);
});
