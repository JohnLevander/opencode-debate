import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "@opencode/plugin";
import { runDebate } from "../src/core/debate.ts";
import { defaults, loadConfig } from "../src/config.ts";
import { renderResult } from "../src/render.ts";
import { executeDebate } from "../src/index.ts";
import { tempRoot } from "./helpers/temp.ts";
import { fakeClient } from "./helpers/fake.ts";
import { commandVerifier } from "../src/verifier.ts";

const reply = (answer: string | null) => JSON.stringify({ answer, points: [], agrees_with_current_answer: answer === null, confidence: 1 });
const base = { question: "Is the async iterator promise unwrapped?", first: "glm", maxRounds: 3, callTimeoutMs: 1000, totalTimeoutMs: 5000 } as const;
const failed = { status: "failed", summary: "Node execution: body receives a Promise, contrary to this answer", checksRun: 1 };

function run(replies: string[], check: (...args: any[]) => any, extra: Record<string, unknown> = {}) {
  const messages: string[] = [];
  const options = { ...base, verifier: { scope: "Native async iterator prediction", timeoutMs: 500, check }, ...extra,
    callModel: async (_model: string, message: string) => { messages.push(message); const text = replies.shift(); assert.ok(text, "unexpected model dispatch"); return { text }; } };
  return { result: runDebate(options as Parameters<typeof runDebate>[0]), messages };
}

test("failed independent checks block unanimous false consensus and false stalemate", async () => {
  const { result, messages } = run(Array.from({ length: 3 }, () => [reply("always unwrapped"), reply(null)]).flat(), async () => failed);
  const r = await result;
  assert.equal(r.status, "max_rounds"); assert.equal(r.turns.length, 6);
  assert.match(messages[1], /body receives a Promise/); assert.match(messages[2], /body receives a Promise/);
  assert.equal((r as any).independentChecks.length, 3);
  assert.ok(r.stopChecks.every(c => c.decision !== "converged" && c.decision !== "stalemate"));
});

test("a corrected answer must pass its own checks before model agreement can converge", async () => {
  const seen: string[] = [];
  const { result } = run([reply("always unwrapped"), reply(null), reply("body receives a Promise"), reply(null)], async ({ answer }) => {
    seen.push(answer); return answer === "body receives a Promise" ? { status: "passed", summary: "Observed native iterator body receives a Promise", checksRun: 2 } : failed;
  });
  const r = await result;
  assert.deepEqual(seen, ["always unwrapped", "body receives a Promise"]); assert.equal(r.rounds, 2); assert.equal(r.status, "converged");
  const records = (r as any).independentChecks;
  assert.deepEqual(records.map((c: any) => c.status), ["failed", "passed"]);
  assert.equal(records[1].answerSha256, createHash("sha256").update(r.answer!).digest("hex"));
  assert.match(renderResult(r, defaults(), "/log", []), /Independent checks/);
});

test("inconclusive and zero-test passes cannot establish independently checked agreement", async () => {
  const r = await run([reply("unknown"), reply(null)], async () => ({ status: "inconclusive", summary: "No executable claim found", checksRun: 0 }), { maxRounds: 1 }).result;
  assert.equal(r.status, "max_rounds");
  const invalid = await run([reply("unchecked"), reply(null)], async () => ({ status: "passed", summary: "Trust me", checksRun: 0 })).result;
  assert.equal(invalid.status, "error"); assert.equal(invalid.failure?.code, "verification");
});

test("a verifier that hangs is aborted and cannot turn late evidence into agreement", async () => {
  let signal: AbortSignal | undefined; let complete!: (value: unknown) => void;
  const { result, messages } = run([reply("unchecked"), reply(null)], async (_candidate, abort) => { signal = abort; return new Promise(resolve => { complete = resolve; }); },
    { verifier: { scope: "Hanging check", timeoutMs: 20, check: (_candidate: unknown, abort: AbortSignal) => { signal = abort; return new Promise(resolve => { complete = resolve; }); } } });
  const r = await result;
  assert.equal(r.status, "error"); assert.equal(r.failure?.code, "verification"); assert.equal(signal?.aborted, true); assert.equal(messages.length, 1);
  complete({ status: "passed", summary: "late", checksRun: 1 }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.status, "error"); assert.equal((r as any).independentChecks.at(-1).status, "inconclusive");
});

test("configured verification runs through the public tool and is checkpointed with the exact answer", async t => {
  const root = await tempRoot("verification-plugin-"); await mkdir(path.join(root, ".opencode"));
  const runner = path.join(root, "check.mjs");
  await writeFile(runner, `let input='';for await(const chunk of process.stdin)input+=chunk;const {answer}=JSON.parse(input);console.log(JSON.stringify({status:answer==='body receives a Promise'?'passed':'failed',summary:'Independent Node fixture: body receives a Promise',checksRun:1}));`);
  await writeFile(path.join(root, ".opencode/debate.config.json"), JSON.stringify({ logDir: path.join(root, "logs"), verifier: { command: [process.execPath, runner], scope: "Iterator prediction", timeoutMs: 1000 } }));
  const old = process.env.OPENCODE_DEBATE_LOG_DIR; delete process.env.OPENCODE_DEBATE_LOG_DIR;
  t.after(() => { if (old === undefined) delete process.env.OPENCODE_DEBATE_LOG_DIR; else process.env.OPENCODE_DEBATE_LOG_DIR = old; });
  const fake = fakeClient(); let p = 0; const original = fake.raw.session.prompt;
  fake.raw.session.prompt = async input => {
    const admitted = await original(input); const text = input.sessionID === "child-0" ? reply(++p === 1 ? "always unwrapped" : "body receives a Promise") : reply(null);
    fake.messages.get(input.sessionID)!.at(-1).content = [{ type: "text", text }]; return admitted;
  };
  const ctx = { ...fake.client, location: { directory: root, project: { directory: root } }, app: { version: "2.0.32" } } as unknown as Plugin.Context;
  const output = await executeDebate(ctx, { question: base.question, first: "glm", max_rounds: 2 }, { sessionID: "parent", agent: "build", signal: new AbortController().signal, progress: async () => {} }, { owned: new Set(), retryHints: new Map(), restrictedReads: new Map() });
  assert.match(output, /Debate result: converged/); assert.match(output, /Independent checks/);
  const log = JSON.parse(await readFile(path.join(root, "logs", (await readdir(path.join(root, "logs")))[0]), "utf8"));
  assert.equal(log.rounds, 2); assert.equal(log.independentChecks.length, 2); assert.equal(log.independentChecks[1].status, "passed"); assert.equal(log.finalResult, output);
  assert.equal((await loadConfig(root, root)).verifier?.scope, "Iterator prediction");
});

test("a previous pass cannot verify a later regressed answer", async () => {
  const { result } = run([reply("correct"), reply(null), reply("regressed"), reply(null), reply("regressed again"), reply(null)], async ({ answer }) => answer === "correct" ? { status: "passed", summary: "first answer passes", checksRun: 1 } : failed, { minRounds: 3 });
  const r = await result; assert.equal(r.status, "max_rounds");
  assert.deepEqual(r.independentChecks?.map(c => c.status), ["passed", "failed", "failed"]);
  assert.equal(r.independentChecks?.at(-1)?.answerSha256, createHash("sha256").update("regressed again").digest("hex"));
});

test("a verifier failure retains the validated revision and its updated point positions", async () => {
  let n = 0;
  const replies = [reply("old"), JSON.stringify({ answer: null, points: [{ id: "C1", summary: "fix", status: "open", note: "old answer wrong" }], agrees_with_current_answer: false, confidence: 1 }),
    JSON.stringify({ answer: "revised", points: [{ id: "C1", summary: "fix", status: "conceded", note: "revision addresses the issue" }], agrees_with_current_answer: false, confidence: 1 })];
  const r = await run(replies, async () => { if (++n > 1) throw Error("checker unavailable"); return failed; }).result;
  assert.equal(r.status, "error"); assert.equal(r.answer, "revised"); assert.equal(r.points[0].proposerStatus, "conceded");
  assert.equal(r.points[0].proposer, "revision addresses the issue"); assert.equal(r.independentChecks?.at(-1)?.status, "inconclusive");
});

test("cancellation during independent verification aborts its signal and preserves partial evidence", async () => {
  const controller = new AbortController(); let aborted = false;
  const { result } = run([reply("candidate")], async (_input, signal) => {
    signal.addEventListener("abort", () => { aborted = true; }); controller.abort(); return new Promise(() => {});
  }, { signal: controller.signal });
  const r = await result; assert.equal(r.status, "cancelled"); assert.equal(aborted, true); assert.equal(r.answer, "candidate");
  assert.equal(r.independentChecks?.at(-1)?.status, "inconclusive");
});

test("total deadline also bounds verification independently of its larger timeout", async () => {
  const r = await run([reply("candidate")], async () => new Promise(() => {}), { totalTimeoutMs: 20 }).result;
  assert.equal(r.status, "error"); assert.equal(r.failure?.code, "total_timeout"); assert.equal(r.independentChecks?.at(-1)?.status, "inconclusive");
});

async function checker(source: string, args: string[] = []) {
  const root = await tempRoot("verifier-process-"); const file = path.join(root, "check with spaces.mjs"); await writeFile(file, source);
  return commandVerifier({ command: [process.execPath, file, ...args], scope: "Process fixture", timeoutMs: 1000 }, root);
}

test("checker receives answer as JSON data and literal arguments without provider credentials", async t => {
  const prior = process.env.AUDIT_VERIFIER_SECRET; process.env.AUDIT_VERIFIER_SECRET = "never-forward";
  t.after(() => { if (prior === undefined) delete process.env.AUDIT_VERIFIER_SECRET; else process.env.AUDIT_VERIFIER_SECRET = prior; });
  const verifier = await checker(`import assert from 'node:assert/strict';let raw='';for await(const c of process.stdin)raw+=c;assert.equal(JSON.parse(raw).answer,'$(touch /never-execute)');assert.equal(process.argv[2],'$HOME; echo literal');assert.equal(process.env.AUDIT_VERIFIER_SECRET,undefined);console.log(JSON.stringify({status:'passed',summary:'data only',checksRun:1}));`, ["$HOME; echo literal"]);
  const result = await verifier.check({ question: "q", answer: "$(touch /never-execute)" }, new AbortController().signal);
  assert.equal(result.status, "passed");
});

for (const [name, source] of [
  ["invalid JSON", "console.log('not json')"],
  ["nonzero exit", "console.log(JSON.stringify({status:'passed',summary:'fake pass',checksRun:1}));process.exitCode=1"],
  ["output overflow", "process.stdout.write('x'.repeat(70_000))"],
  ["zero-test pass", "console.log(JSON.stringify({status:'passed',summary:'no tests',checksRun:0}))"],
  ["extra forged fields", "console.log(JSON.stringify({status:'passed',summary:'forged',checksRun:1,answer:'changed'}))"],
] as const) test(`checker ${name} fails closed`, async () => {
  const verifier = await checker(source);
  await assert.rejects(verifier.check({ question: "q", answer: "A" }, new AbortController().signal), (error: any) => error.code === "verification");
});

test("aborting a checker kills its native process", async () => {
  const root = await tempRoot("verifier-abort-"); const pidFile = path.join(root, "pid");
  const verifier = await checker(`import{writeFileSync}from'node:fs';writeFileSync(process.argv[2],String(process.pid));setInterval(()=>{},1000);`, [pidFile]);
  const controller = new AbortController(); const work = verifier.check({ question: "q", answer: "A" }, controller.signal); work.catch(() => {});
  // Synchronize on actual process startup; do not depend on a machine-speed delay.
  let pid: number | undefined;
  for (let i = 0; i < 100; i++) { pid = Number(await readFile(pidFile, "utf8").catch(() => "")) || undefined; if (pid) break; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.ok(pid); controller.abort(new Error("audit cancellation")); await assert.rejects(work, /audit cancellation/);
  let alive = true;
  for (let i = 0; i < 100 && alive; i++) { try { process.kill(pid, 0); await new Promise(resolve => setTimeout(resolve, 10)); } catch { alive = false; } }
  assert.equal(alive, false);
});

test("supplied prediction checker executes a trusted fixture and never evaluates proposed source", async () => {
  const root = await tempRoot("prediction-fixture-"); const fixture = path.join(root, "fixture.mjs");
  await writeFile(fixture, `const iterator = { [Symbol.asyncIterator]() {return this}, async next(){return {value:Promise.resolve(7),done:false}} };for await(const value of iterator){console.log(JSON.stringify({promise:value instanceof Promise}));break}`);
  const verifier = commandVerifier({ command: [process.execPath, path.resolve("scripts/verify-node-prediction.mjs"), fixture], scope: "JSON runtime prediction only", timeoutMs: 2000 }, root);
  for (const prediction of [false, true]) {
    const result = await verifier.check({ question: "q", answer: `Do not execute this prose: process.exit(9)\n\`\`\`json\n${JSON.stringify({ prediction: { promise: prediction } })}\n\`\`\`` }, new AbortController().signal);
    assert.equal(result.status, prediction ? "passed" : "failed"); assert.equal(result.checksRun, 1); assert.match(result.summary, /Observed JSON/);
  }
  assert.equal((await verifier.check({ question: "q", answer: "No machine-checkable prediction" }, new AbortController().signal)).status, "inconclusive");
});
