import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreContributions } from "../src/core/contribution.ts";
import type { Debater, Reply, Turn } from "../src/core/types.ts";
const turn = (debater: Debater, answer: string | null, note?: string): Pick<Turn, "debater" | "parsed" | "error"> => ({ debater,
  parsed: { answer, points: note ? [{ id: "C1", status: "open", summary: "Check", note }] : [], agrees_with_current_answer: false, confidence: 0.8 } satisfies Reply });
const opening = "Cobalt batteries support lunar instruments during darkness.";
const correction = "Thermal insulation additionally prevents destructive freezing across prolonged polar winter conditions.";
const base = { question: "Choose a design.", status: "converged" as const };
test("credits retained Challenger language before the Proposer adopts it", () => {
  const answer = `${opening} ${correction}`;
  const result = scoreContributions({ ...base, answer, turns: [turn("glm", opening), turn("deepseek", null, correction), turn("glm", answer)] });
  assert.equal(result.winner, "deepseek"); assert.equal(result.words.glm, 7); assert.equal(result.words.deepseek, 11);
  assert.equal(result.providedWords, 0); assert.equal(result.unmatchedWords, 0);
});
test("repetition, casing and punctuation never transfer earlier credit", () => {
  const r = scoreContributions({ ...base, answer: opening.toUpperCase(), turns: [turn("deepseek", opening), turn("glm", null, opening), turn("deepseek", opening)] });
  assert.equal(r.winner, "deepseek"); assert.equal(r.words.deepseek, 7); assert.equal(r.words.glm, 0);
});
test("excludes supplied context and reports no evidence when all words came from it", () => {
  const r = scoreContributions({ ...base, context: opening, answer: opening, turns: [turn("glm", opening)] });
  assert.equal(r.winner, "undetermined"); assert.equal(r.providedWords, 7); assert.equal(r.words.glm, 0);
});
test("equal retained contributions tie; short or unmatched answers remain undetermined", () => {
  const other = "Shielding protects sensitive electronics against solar radiation.";
  const tied = scoreContributions({ ...base, answer: `${opening} ${other}`, turns: [turn("glm", opening), turn("deepseek", null, other)] });
  assert.equal(tied.winner, "tie"); assert.equal(tied.words.glm, 7); assert.equal(tied.words.deepseek, 7);
  const short = scoreContributions({ ...base, answer: "Use shielding.", turns: [turn("glm", "Use shielding.")] });
  assert.equal(short.winner, "undetermined"); assert.equal(short.unmatchedWords, 2);
});
test("does not infer paraphrase provenance or use unparsed/error replies", () => {
  const r = scoreContributions({ ...base, answer: opening, turns: [turn("deepseek", null, "Select cells made from cobalt for nighttime lunar experiments."),
    { ...turn("deepseek", opening), error: "Invalid reply" }, turn("glm", opening)] });
  assert.equal(r.words.deepseek, 0); assert.equal(r.winner, "glm");
});
test("partial errors and missing answers never declare a winner", () => {
  const partial = scoreContributions({ ...base, status: "error", answer: opening, turns: [turn("glm", opening)] });
  assert.equal(partial.basis, "partial"); assert.equal(partial.winner, "undetermined"); assert.equal(partial.words.glm, 7);
  const empty = scoreContributions({ ...base, answer: null, turns: [] });
  assert.equal(empty.basis, "none"); assert.equal(empty.totalWords, 0); assert.equal(empty.winner, "undetermined");
});
