import { randomInt } from "node:crypto";
import { scoreContributions } from "./contribution.ts";
import { parseReply } from "./parse.ts";
import { DebateError, type DebateOptions, type DebateResult, type Debater, type Point, type Reply, type Role, type Turn } from "./types.ts";
import { openingPrompt, firstCritiquePrompt, critiquePrompt, revisionPrompt, missingPointsPrompt, jsonRepairPrompt, INTERRUPTION_PREFIX } from "../prompts.ts";

export function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DebateError("cancelled", "Debate cancelled");
}
/** Observe completion only while live; attach both handlers so late rejection is consumed. */
export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(abortReason(signal)); };
    signal.addEventListener("abort", abort, { once: true });
    work.then((value) => { signal.removeEventListener("abort", abort); signal.aborted ? reject(abortReason(signal)) : resolve(value); },
      (error) => { signal.removeEventListener("abort", abort); reject(signal.aborted ? abortReason(signal) : error); });
    if (signal.aborted) abort();
  });
}
function delay(ms: number, signal: AbortSignal): Promise<void> {
  let timer: ReturnType<typeof setTimeout>;
  return abortable(new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); }), signal).finally(() => clearTimeout(timer));
}
export function rateLimit(error: unknown): { retryAfterMs?: number } | undefined {
  if (error instanceof DebateError && error.code === "rate_limit") return { retryAfterMs: error.retryAfterMs };
  if (error && typeof error === "object") {
    const e = error as { status?: number; statusCode?: number; code?: string; retryAfterMs?: number };
    if (e.status === 429 || e.statusCode === 429 || e.code === "rate_limit") return { retryAfterMs: e.retryAfterMs };
  }
}
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
const snapshot = (points: Map<string, Point>) => structuredClone([...points.values()]);

export async function runDebate(opts: DebateOptions): Promise<DebateResult> {
  const minRounds = opts.minRounds ?? 1;
  const now = opts.now ?? Date.now;
  const startedAt = now();
  const proposer: Debater = opts.first === "random" ? ((opts.random ? opts.random() < 0.5 : randomInt(0, 2) === 0) ? "glm" : "deepseek") : opts.first;
  const result: DebateResult = {
    question: opts.question, context: opts.context, assignment: { proposer, challenger: proposer === "glm" ? "deepseek" : "glm" },
    limits: { minRounds, maxRounds: opts.maxRounds }, stopChecks: [],
    status: "error", reason: "Debate did not finish", rounds: 0, answer: null, points: [], pointHistory: [], turns: [], startedAt, endedAt: startedAt,
  };
  const overall = new AbortController();
  const cancel = () => overall.abort(new DebateError("cancelled", "Debate cancelled by the caller"));
  opts.signal?.addEventListener("abort", cancel, { once: true });
  if (opts.signal?.aborted) cancel();
  const deadline = startedAt + opts.totalTimeoutMs;
  const totalTimer = setTimeout(() => overall.abort(new DebateError("total_timeout", "Total debate deadline exceeded")), Math.max(0, opts.totalTimeoutMs));
  const points = new Map<string, Point>(); let highestID = 0;
  const live = () => {
    if (!overall.signal.aborted && now() >= deadline) overall.abort(new DebateError("total_timeout", "Total debate deadline exceeded"));
    if (overall.signal.aborted) throw abortReason(overall.signal);
  };
  const invoke = async (turn: Turn, message: string, kind: Turn["attempts"][number]["kind"]): Promise<{ text: string; reasoning?: string }> => {
    let timedOut = false;
    let rateAttempts = 0;
    for (;;) {
      live();
      const attempt: Turn["attempts"][number] = { message, startedAt: now(), endedAt: now(), kind };
      turn.attempts.push(attempt); turn.retries = turn.attempts.length - 1;
      const controller = new AbortController();
      const abort = () => controller.abort(overall.signal.reason);
      overall.signal.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => controller.abort(new DebateError("call_timeout", `Call timeout after ${opts.callTimeoutMs} ms`)), opts.callTimeoutMs);
      let failure: unknown;
      try {
        const response = await abortable(Promise.resolve().then(() => {
          if (controller.signal.aborted) throw abortReason(controller.signal);
          return opts.callModel(turn.debater, message, controller.signal);
        }), controller.signal);
        live();
        if (now() - attempt.startedAt >= opts.callTimeoutMs) throw new DebateError("call_timeout", `Call timeout after ${opts.callTimeoutMs} ms`);
        if (typeof response.text !== "string") throw new DebateError("transport", "Model returned no text string");
        attempt.text = response.text; attempt.reasoning = response.reasoning;
        return response;
      } catch (error) {
        failure = controller.signal.aborted ? abortReason(controller.signal) : error;
        attempt.error = messageOf(failure);
      } finally {
        attempt.endedAt = now(); clearTimeout(timer); overall.signal.removeEventListener("abort", abort);
      }
      live();
      if (failure instanceof DebateError && failure.code === "call_timeout" && !timedOut) {
        timedOut = true; message = `${INTERRUPTION_PREFIX}\n${message}`; kind = "timeout_retry";
        opts.onEvent?.({ type: "retry", turnID: turn.id, reason: "call_timeout", delayMs: 0 });
        continue;
      }
      const limited = rateLimit(failure);
      if (limited && ++rateAttempts < 3) {
        const waitMs = Math.max(1000 * 2 ** (rateAttempts - 1), limited.retryAfterMs ?? 0);
        opts.onEvent?.({ type: "retry", turnID: turn.id, reason: "rate_limit", delayMs: waitMs });
        await delay(Math.min(waitMs, Math.max(0, deadline - now())), overall.signal); live(); kind = "rate_limit_retry"; continue;
      }
      throw failure;
    }
  };
  const validateChallenger = (reply: Reply): number => {
    let next = highestID;
    for (const point of reply.points) {
      if (!points.has(point.id)) {
        next++;
        if (Number(point.id.slice(1)) !== next || point.status !== "open") throw new Error(`New challenger point must be open and use next unused ID C${next}`);
      }
    }
    return next;
  };
  const takeTurn = async (id: string, round: number, role: Role, message: string): Promise<Turn> => {
    live();
    const turn: Turn = { id, round, role, debater: result.assignment[role], message, startedAt: now(), endedAt: now(), retries: 0, attempts: [] };
    result.turns.push(turn);
    opts.onEvent?.({ type: "turn_start", turn: structuredClone(turn) });
    let repairedJSON = false, repairedMissing = false;
    let kind: Turn["attempts"][number]["kind"] = "initial";
    try {
      for (;;) {
        const response = await invoke(turn, message, kind);
        turn.text = response.text; turn.reasoning = response.reasoning;
        let parsed: Reply;
        try {
          parsed = parseReply(response.text);
          if (role === "proposer" && !parsed.answer) throw new Error("Proposer must provide a nonempty answer");
          if (role === "challenger" && parsed.points.some((p) => p.status === "conceded" || p.status === "defended")) throw new Error("Challenger may only use open/resolved/withdrawn");
          if (role === "challenger") validateChallenger(parsed);
          turn.attempts.at(-1)!.parsed = parsed;
        } catch (error) {
          const reason = messageOf(error);
          turn.attempts.at(-1)!.error = `Invalid reply: ${reason}`;
          opts.onEvent?.({ type: "validation_failure", turnID: id, at: now(), stage: "reply", reason, repair: !repairedJSON });
          if (repairedJSON) throw new DebateError("protocol", `Invalid reply twice in ${id}: ${reason}`);
          repairedJSON = true; message = jsonRepairPrompt(role, reason, [...points.keys()], highestID + 1); kind = "json_repair"; continue;
        }
        if (role === "proposer") {
          const addressed = new Set(parsed.points.filter((p) => p.status === "conceded" || p.status === "defended").map((p) => p.id));
          const missing = [...points.values()].filter((p) => p.status === "open" && !addressed.has(p.id)).map((p) => p.id);
          if (missing.length) {
            turn.attempts.at(-1)!.error = `Missing open point IDs: ${missing.join(", ")}`;
            opts.onEvent?.({ type: "validation_failure", turnID: id, at: now(), stage: "missing_points", reason: turn.attempts.at(-1)!.error!, repair: !repairedMissing });
            if (repairedMissing) throw new DebateError("protocol", `Proposer still omitted ${missing.join(", ")}`);
            repairedMissing = true; message = missingPointsPrompt(missing); kind = "missing_points"; continue;
          }
        }
        turn.parsed = parsed; return turn;
      }
    } catch (error) { turn.error = messageOf(error); throw error; }
    finally { turn.endedAt = now(); opts.onTurn?.(structuredClone(turn)); }
  };
  const applyChallenger = (reply: Reply) => {
    highestID = validateChallenger(reply);
    for (const p of reply.points) {
      const old = points.get(p.id);
      points.set(p.id, { id: p.id, summary: p.summary, status: p.status as Point["status"], challenger: p.note, proposer: old?.proposer ?? "Not yet addressed", proposerStatus: old?.proposerStatus });
    }
    // Omitted points retain their existing C-authoritative status; omission cannot resolve them.
  };
  try {
    if (!opts.question.trim() || !Number.isInteger(opts.maxRounds) || opts.maxRounds < 1 || opts.maxRounds > 8 || !Number.isFinite(opts.callTimeoutMs) || opts.callTimeoutMs <= 0 || !Number.isFinite(opts.totalTimeoutMs) || opts.totalTimeoutMs <= 0) throw new DebateError("protocol", "Invalid debate options");
    if (!Number.isInteger(minRounds) || minRounds < 1 || minRounds > opts.maxRounds) throw new DebateError("protocol", "min_rounds must be an integer from 1 to max_rounds");
    live(); opts.onEvent?.({ type: "start", assignment: result.assignment });
    let proposal = await takeTurn("P0", 0, "proposer", openingPrompt(opts.question, opts.context));
    result.answer = proposal.parsed!.answer;
    let previousOpen: string | undefined;
    for (let round = 1; round <= opts.maxRounds; round++) {
      result.rounds = round;
      const critique = await takeTurn(`C${round}`, round, "challenger", round === 1 ? firstCritiquePrompt(opts.question, opts.context, proposal.text!) : critiquePrompt(proposal.text!, snapshot(points)));
      applyChallenger(critique.parsed!);
      result.pointHistory.push({ turnID: critique.id, points: snapshot(points) });
      const open = [...points.values()].filter((p) => p.status === "open").map((p) => p.id).sort();
      const key = JSON.stringify(open);
      const minimumMet = round >= minRounds;
      const decision = minimumMet && critique.parsed!.agrees_with_current_answer && !open.length ? "converged"
        : round >= Math.max(2, minRounds) && previousOpen === key ? "stalemate"
        : round === opts.maxRounds ? "max_rounds" : "continue";
      const check: DebateResult["stopChecks"][number] = { turnID: critique.id, round, minimumMet, agrees: critique.parsed!.agrees_with_current_answer,
        openIDs: open, previousOpenIDs: previousOpen === undefined ? null : JSON.parse(previousOpen) as string[], decision };
      result.stopChecks.push(check); opts.onEvent?.({ type: "stop_check", check: structuredClone(check) });
      if (decision !== "continue") {
        result.status = decision;
        result.reason = decision === "converged" ? "Challenger endorses the current answer with no open points"
          : decision === "stalemate" ? "Open point IDs are unchanged across consecutive Challenger turns" : "Maximum Challenger rounds reached";
        break;
      }
      previousOpen = key;
      proposal = await takeTurn(`P${round}`, round, "proposer", revisionPrompt(critique.text!, snapshot(points)));
      result.answer = proposal.parsed!.answer;
      for (const p of proposal.parsed!.points) {
        const old = points.get(p.id);
        if (old && (p.status === "conceded" || p.status === "defended")) { old.proposerStatus = p.status; old.proposer = p.note; }
      }
      result.pointHistory.push({ turnID: proposal.id, points: snapshot(points) });
    }
  } catch (error) {
    result.status = error instanceof DebateError && error.code === "cancelled" ? "cancelled" : "error";
    result.reason = messageOf(error);
  } finally {
    clearTimeout(totalTimer); opts.signal?.removeEventListener("abort", cancel);
    result.points = snapshot(points); result.endedAt = now();
  }
  result.contributions = scoreContributions(result);
  opts.onEvent?.({ type: "end", result: structuredClone(result) });
  return result;
}
