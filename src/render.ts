import type { DebateResult } from "./core/types.ts";
import type { SessionDetail } from "./adapters/types.ts";
import type { DebateConfig } from "./config.ts";
export function renderResult(result: DebateResult, config: DebateConfig, logPath: string, sessions: SessionDetail[], transcript = false): string {
  const name = (debater: "glm" | "deepseek") => config.backend === "openai-compatible"
    ? config.openaiCompatible.models[debater]
    : `${config.models[debater].providerID}/${config.models[debater].modelID}`;
  const lines = [`## Debate result: ${result.status}`, `Proposer: ${name(result.assignment.proposer)} | Challenger: ${name(result.assignment.challenger)} | Rounds: ${result.rounds}`, "", "### Final answer", result.answer ?? "No valid answer was gathered before the debate stopped."];
  const contribution = result.contributions;
  if (contribution) {
    const winner = contribution.winner === "tie" ? "Tie" : contribution.winner === "undetermined" ? "Undetermined" : name(contribution.winner);
    const basis = contribution.basis === "partial" ? " Partial answer; no winner declared." : contribution.basis === "none" ? " No valid answer." : "";
    lines.push("", `Contribution winner (text-reuse estimate): ${winner}. ${name("glm")}: ${contribution.words.glm} credited words; ${name("deepseek")}: ${contribution.words.deepseek}. Excluded: ${contribution.providedWords} from supplied question/context; unmatched: ${contribution.unmatchedWords}.${basis}`);
  }
  const open = result.points.filter(p => p.status === "open");
  if (open.length) lines.push("", "### Unresolved points", ...open.map(p => `- ${p.id}: ${p.summary}. Challenger: ${p.challenger}. Proposer: ${p.proposer}.`));
  lines.push("", "### Details", `Reason: ${result.reason}`, `Log: ${logPath}`, `Sessions: ${sessions.length ? sessions.map(s => `${s.title} (${s.id})`).join("; ") : config.backend === "openai-compatible" ? "In-memory fallback conversations; no OpenCode child sessions." : "No child sessions were created."}`);
  if (transcript) {
    lines.push("", "### Transcript");
    for (const turn of result.turns) lines.push("", `#### ${turn.id} — ${name(turn.debater)} (${turn.role})`, turn.text ?? `No completed reply. ${turn.error ?? ""}`);
  }
  return lines.join("\n");
}
