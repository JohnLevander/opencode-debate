import { test } from "node:test";
import assert from "node:assert/strict";
import { runDebate } from "../src/core/debate.ts";
import { parseReply } from "../src/core/parse.ts";
import { DebateError, type DebateOptions, type Reply, type ReplyPoint } from "../src/core/types.ts";
import { INTERRUPTION_PREFIX } from "../src/prompts.ts";

const p = (id = "C1", status: ReplyPoint["status"] = "open"): ReplyPoint => ({ id, status, summary: `Issue ${id}`, note: `${status} because of specific evidence` });
const json = (answer: string | null = "The answer", points: ReplyPoint[] = [], agrees = false) => JSON.stringify({ answer, points, agrees_with_current_answer: agrees, confidence: 0.8 } satisfies Reply);
const base: Omit<DebateOptions, "callModel"> = { question: "A question", first: "glm", maxRounds: 4, callTimeoutMs: 500, totalTimeoutMs: 5000 };
function scripted(replies: (string | Error | (() => Promise<{ text: string }>))[], extra: Partial<DebateOptions> = {}) {
  const calls: { model: string; message: string; signal: AbortSignal }[] = [];
  const result = runDebate({ ...base, ...extra, callModel: async (model, message, signal) => {
    calls.push({ model, message, signal }); const next = replies.shift();
    if (next instanceof Error) throw next;
    if (typeof next === "function") return next();
    if (typeof next !== "string") throw new Error("Script exhausted");
    return { text: next, reasoning: "private reasoning: NEVER RELAY" };
  } });
  return { result, calls };
}
test("parser takes last outer JSON including fenced prose and string braces", () => {
  const expected = json("A } { \\\" quoted answer", [p()]);
  assert.equal(parseReply(`Draft {}\n\`\`\`json\n${expected}\n\`\`\``).answer, JSON.parse(expected).answer);
  assert.throws(() => parseReply(`${json()}\n{"answer":`));
  assert.throws(() => parseReply(json("ok", [p(), p()])));
  assert.throws(() => parseReply(JSON.stringify({ ...JSON.parse(json()), confidence: 1.1 })));
});
test("converges at C1 and only relays text", async () => {
  const { result, calls } = scripted([json(), json(null, [], true)]);
  const r = await result; assert.equal(r.status, "converged"); assert.equal(r.rounds, 1);
  assert.deepEqual(r.turns.map(t => t.id), ["P0", "C1"]);
  assert.equal(r.answer, "The answer"); assert.equal(calls[1].model, "deepseek");
  assert.ok(!calls[1].message.includes("private reasoning")); assert.ok(r.turns[0].reasoning?.includes("private reasoning"));
});
test("converges after revision; P cannot resolve C's point", async () => {
  const r = await scripted([json(), json(null, [p()]), json("Fixed answer", [p("C1", "conceded")]), json(null, [p("C1", "resolved")], true)]).result;
  assert.equal(r.status, "converged"); assert.equal(r.answer, "Fixed answer");
  assert.equal(r.pointHistory[1].points[0].status, "open"); assert.equal(r.pointHistory[2].points[0].status, "resolved");
});
test("unchanged open IDs at C2 cause stalemate despite changed wording", async () => {
  const r = await scripted([json(), json(null, [p()]), json("Revised", [p("C1", "defended")]), json(null, [{ ...p(), note: "A specific reply to defense" }])]).result;
  assert.equal(r.status, "stalemate"); assert.equal(r.turns.at(-1)?.id, "C2");
  assert.equal(r.points[0].proposerStatus, "defended");
});
test("max_rounds stops on C and never produces P_max", async () => {
  const r = await scripted([json(), json(null, [p()]), json("Revision", [p("C1", "conceded")]), json(null, [p(), p("C2")])], { maxRounds: 2 }).result;
  assert.equal(r.status, "max_rounds"); assert.deepEqual(r.turns.map(t => t.id), ["P0", "C1", "P1", "C2"]);
});
test("bad JSON recovers once", async () => {
  const { result, calls } = scripted(["bad JSON", json(), json(null, [], true)]);
  const r = await result; assert.equal(r.status, "converged"); assert.equal(r.turns[0].attempts.length, 2);
  assert.match(calls[1].message, /Reply with ONLY the JSON object/);
});
test("bad JSON twice ends with error and preserves attempts", async () => {
  const r = await scripted(["not JSON", "still not JSON"]).result;
  assert.equal(r.status, "error"); assert.match(r.reason, /Invalid JSON twice/); assert.equal(r.turns[0].attempts.length, 2);
});
test("call timeout retries with interruption prefix and discards late output", async () => {
  let finish!: (value: { text: string }) => void;
  const { result, calls } = scripted([() => new Promise(resolve => { finish = resolve; }), json("Recovered"), json(null, [], true)], { callTimeoutMs: 15 });
  const r = await result; assert.equal(r.status, "converged"); assert.ok(calls[0].signal.aborted);
  assert.ok(calls[1].message.startsWith(INTERRUPTION_PREFIX)); assert.equal(r.answer, "Recovered");
  finish({ text: json("LATE WRONG ANSWER") }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.answer, "Recovered"); assert.equal(r.turns[0].attempts[0].text, undefined);
});
test("two call timeouts return an error", async () => {
  const never = () => new Promise<{ text: string }>(() => {});
  const r = await scripted([never, never], { callTimeoutMs: 10 }).result;
  assert.equal(r.status, "error"); assert.match(r.reason, /Call timeout/); assert.equal(r.turns[0].attempts.length, 2);
});
test("real total deadline interrupts an unresponsive call", async () => {
  const r = await scripted([() => new Promise(() => {})], { callTimeoutMs: 1000, totalTimeoutMs: 15 }).result;
  assert.equal(r.status, "error"); assert.match(r.reason, /Total debate deadline/);
});
test("injectable clock enforces total deadline even before timer dispatch", async () => {
  let time = 100;
  const r = await runDebate({ ...base, now: () => time, totalTimeoutMs: 100, callModel: async () => { time += 150; return { text: json() }; } });
  assert.equal(r.status, "error"); assert.match(r.reason, /Total debate deadline/); assert.equal(r.answer, null);
});
test("P missing a point gets one targeted repair", async () => {
  const { result, calls } = scripted([json(), json(null, [p()]), json("Forgot"), json("Corrected", [p("C1", "conceded")]), json(null, [p("C1", "resolved")], true)]);
  const r = await result; assert.equal(r.status, "converged"); assert.match(calls[3].message, /open point IDs.*C1/);
});
test("P omitting twice fails without claiming concession", async () => {
  const r = await scripted([json(), json(null, [p()]), json("Forgot"), json("Forgot again")]).result;
  assert.equal(r.status, "error"); assert.match(r.reason, /still omitted C1/); assert.equal(r.points[0].status, "open");
});
test("P inventing IDs is ignored", async () => {
  const r = await scripted([json("Initial", [p("C99", "defended")]), json(null, [p()]), json("Revision", [p("C1", "defended"), p("C99", "conceded")]), json(null, [p()])]).result;
  assert.equal(r.status, "stalemate"); assert.deepEqual(r.points.map(p => p.id), ["C1"]);
});
test("C omission cannot silently close a point", async () => {
  const r = await scripted([json(), json(null, [p()]), json("Revision", [p("C1", "conceded")]), json(null, [], true)]).result;
  assert.equal(r.status, "stalemate"); assert.equal(r.points[0].status, "open");
});
test("mid-debate cancellation returns collected answer and turns", async () => {
  const controller = new AbortController();
  const r = await scripted([json(), () => new Promise(() => { controller.abort(); })], { signal: controller.signal }).result;
  assert.equal(r.status, "cancelled"); assert.equal(r.answer, "The answer"); assert.equal(r.turns.length, 2);
});
test("already cancelled makes no model calls", async () => {
  const controller = new AbortController(); controller.abort();
  const { result, calls } = scripted([], { signal: controller.signal }); assert.equal((await result).status, "cancelled"); assert.equal(calls.length, 0);
});
test("seeded random produces both assignments and explicit first wins", async () => {
  const assignments = new Set<string>(); let seed = 37;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 20; i++) assignments.add((await scripted([json(), json(null, [], true)], { first: "random", random }).result).assignment.proposer);
  assert.deepEqual([...assignments].sort(), ["deepseek", "glm"]);
  assert.equal((await scripted([json(), json(null, [], true)], { first: "deepseek", random: () => 0 }).result).assignment.proposer, "deepseek");
});
test("rate limits make at most three attempts", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const limited = () => new DebateError("rate_limit", "HTTP 429", 2000);
  const { result, calls } = scripted([limited(), limited(), limited()], { totalTimeoutMs: 20_000, callTimeoutMs: 5000 });
  for (let i = 0; i < 20; i++) { await new Promise(resolve => setImmediate(resolve)); t.mock.timers.tick(500); }
  const r = await result; assert.equal(r.status, "error"); assert.equal(calls.length, 3); assert.equal(r.turns[0].attempts.length, 3);
});
