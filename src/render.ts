import type { DebateResult } from "./core/types.ts";
import type { SessionDetail } from "./adapters/types.ts";
import type { DebateConfig } from "./config.ts";
import { escapeInvalidUnicode } from "./core/unicode.ts";
export const VERIFICATION_NOTICE = "Verification: not independently verified. Model agreement is not proof of correctness; only explicitly reported independent checks provide scoped evidence.";
export function renderResult(result: DebateResult, config: DebateConfig, logPath: string, sessions: SessionDetail[], transcript = false): string {
  const name = (debater: "glm" | "deepseek") => config.backend === "openai-compatible"
    ? config.openaiCompatible.models[debater]
    : `${config.models[debater].providerID}/${config.models[debater].modelID}`;
  const incomplete = result.status === "error" || result.status === "cancelled";
  const check = result.independentChecks?.at(-1);
  const heading = incomplete ? "Partial answer (debate incomplete)" : result.status === "converged" ? check?.status === "passed" ? "Agreed answer (independent checks passed)" : "Agreed answer (not independently verified)" : "Current answer (not converged)";
  const lines = [`## Debate result: ${result.status}`, `Proposer: ${name(result.assignment.proposer)} | Challenger: ${name(result.assignment.challenger)} | Rounds: ${result.rounds}`,
    check ? "Verification: the full answer is not independently verified. The independent checks below cover only their stated scope; passing finite tests is not proof of every claim." : VERIFICATION_NOTICE,
    "", `### ${heading}`, result.answer ?? "No valid answer was gathered before the debate stopped."];
  if (check) lines.push("", "### Independent checks", `Status: ${check.status}. Executed checks: ${check.checksRun}. Scope: ${check.scope}.`,
    `Answer SHA-256: ${check.answerSha256}`, check.summary);
  if (incomplete) {
    const reviews = result.turns.filter(t => t.role === "challenger" && t.parsed).length;
    lines.push("", `Validated challenger reviews: ${reviews}. ${reviews === 0 ? (result.answer ? "The proposer answer has not passed a validated challenger review." : "No challenger review was validated.") : "The debate stopped before reaching a completed result."}`);
    if (result.failure) lines.push(`Stopped at ${result.failure.turnID ?? "initialization"} (${result.failure.code}); ${result.failure.attempts} attempt(s) in that turn; ${result.failure.validationFailures} rejected reply attempt(s) across the run.`);
  }
  const contribution = result.contributions;
  if (contribution) {
    const winner = contribution.winner === "tie" ? "Tie" : contribution.winner === "undetermined" ? "Undetermined" : name(contribution.winner);
    const basis = contribution.basis === "partial" ? " Partial answer; no winner declared." : contribution.basis === "none" ? " No valid answer." : "";
    lines.push("", `Contribution winner (text-reuse estimate): ${winner}. ${name("glm")}: ${contribution.words.glm} credited words; ${name("deepseek")}: ${contribution.words.deepseek}. Excluded: ${contribution.providedWords} from supplied question/context; unmatched: ${contribution.unmatchedWords}.${basis}`);
  }
  const open = result.points.filter(p => p.status === "open");
  if (open.length) lines.push("", "### Unresolved points", ...open.map(p => `- ${p.id}: ${p.summary}. Challenger: ${p.challenger}. Proposer: ${p.proposer}.`));
  if (!open.length && result.status !== "converged") lines.push("", "### Unresolved points", "No validated open points were recorded. This does not establish agreement; the debate did not converge.");
  lines.push("", "### Details", `Reason: ${result.reason}`, `Log: ${logPath}`, `Sessions: ${sessions.length ? sessions.map(s => `${s.title} (${s.id})`).join("; ") : config.backend === "openai-compatible" ? "In-memory fallback conversations; no OpenCode child sessions." : "No child sessions were created."}`);
  if (transcript) {
    lines.push("", "### Transcript");
    for (const turn of result.turns) lines.push("", `#### ${turn.id} — ${name(turn.debater)} (${turn.role})${turn.parsed ? "" : " — unvalidated reply"}`, turn.text ?? `No completed reply. ${turn.error ?? ""}`);
  }
  return escapeInvalidUnicode(lines.join("\n"));
}
