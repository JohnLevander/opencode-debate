import type { ContributionScore, DebateStatus, Debater, Turn } from "./types.ts";

const stopWords = new Set("a an and are as at be been but by for from had has have he her him his i if in is it its of on or our she so than that the their them then there these they this those to was we were what when which who will with you your".split(" "));
const words = (text: string) => text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
const width = 5;
function phrase(tokens: string[], start: number): string | undefined {
  const span = tokens.slice(start, start + width);
  if (span.length !== width || span.filter(word => !stopWords.has(word)).length < 3) return;
  return span.join("\u0000");
}
/** Text provenance only: no semantic inference, model judging, or effect on debate control. */
export function scoreContributions(input: {
  question: string; context?: string; answer: string | null; status: DebateStatus;
  turns: readonly Pick<Turn, "debater" | "parsed" | "error">[];
}): ContributionScore {
  const tokens = words(input.answer ?? "");
  const score: ContributionScore = { method: "retained-phrases-v1", winner: "undetermined", words: { glm: 0, deepseek: 0 },
    providedWords: 0, unmatchedWords: tokens.length, totalWords: tokens.length,
    basis: !input.answer ? "none" : ["error", "cancelled"].includes(input.status) ? "partial" : "final" };
  if (!tokens.length) return score;
  type Source = { owner: Debater | "provided"; order: number };
  const first = new Map<string, Source>();
  let order = 0;
  const add = (text: string, owner: Source["owner"]) => {
    const source = { owner, order: order++ }; const chunk = words(text);
    for (let i = 0; i <= chunk.length - width; i++) {
      const key = phrase(chunk, i);
      if (key !== undefined && !first.has(key)) first.set(key, source);
    }
  };
  add(input.question, "provided"); if (input.context) add(input.context, "provided");
  for (const turn of input.turns) {
    if (turn.error || !turn.parsed) continue;
    if (turn.parsed.answer) add(turn.parsed.answer, turn.debater);
    for (const point of turn.parsed.points) { add(point.summary, turn.debater); add(point.note, turn.debater); }
  }
  const owners: (Source | undefined)[] = new Array(tokens.length);
  for (let i = 0; i <= tokens.length - width; i++) {
    const key = phrase(tokens, i); const source = key === undefined ? undefined : first.get(key);
    if (!source) continue;
    for (let j = i; j < i + width; j++) if (!owners[j] || source.order < owners[j]!.order) owners[j] = source;
  }
  for (const source of owners) {
    if (!source) continue;
    score.unmatchedWords--;
    if (source.owner === "provided") score.providedWords++;
    else score.words[source.owner]++;
  }
  if (score.basis === "final" && score.words.glm + score.words.deepseek > 0) {
    score.winner = score.words.glm === score.words.deepseek ? "tie" : score.words.glm > score.words.deepseek ? "glm" : "deepseek";
  }
  return score;
}
