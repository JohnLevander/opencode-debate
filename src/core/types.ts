export type Debater = "glm" | "deepseek";
export type Role = "proposer" | "challenger";
export type PointStatus = "open" | "conceded" | "defended" | "resolved" | "withdrawn";
export interface ReplyPoint { id: string; summary: string; status: PointStatus; note: string }
export interface Reply { answer: string | null; points: ReplyPoint[]; agrees_with_current_answer: boolean; confidence: number }
export interface Point {
  id: string; summary: string; status: "open" | "resolved" | "withdrawn";
  challenger: string; proposer: string; proposerStatus?: "conceded" | "defended";
}
export interface Attempt {
  message: string; startedAt: number; endedAt: number; text?: string; reasoning?: string;
  parsed?: Reply; error?: string; errorCode?: DebateErrorCode; kind: "initial" | "timeout_retry" | "json_repair" | "missing_points" | "rate_limit_retry" | "provider_retry";
}
export interface Turn {
  id: string; round: number; debater: Debater; role: Role; message: string;
  startedAt: number; endedAt: number; retries: number; attempts: Attempt[]; text?: string; reasoning?: string; parsed?: Reply; error?: string;
}
export type DebateStatus = "converged" | "stalemate" | "max_rounds" | "cancelled" | "error";
export interface ContributionScore {
  method: "retained-phrases-v1"; winner: Debater | "tie" | "undetermined";
  words: Record<Debater, number>; providedWords: number; unmatchedWords: number; totalWords: number;
  basis: "final" | "partial" | "none";
}
export interface StopCheck {
  turnID: string; round: number; minimumMet: boolean; agrees: boolean; openIDs: string[]; previousOpenIDs: string[] | null;
  decision: "continue" | "converged" | "stalemate" | "max_rounds";
}
export interface DebateResult {
  verification: "not_independently_verified";
  question: string; context?: string; assignment: { proposer: Debater; challenger: Debater };
  contributions?: ContributionScore;
  limits: { minRounds: number; maxRounds: number }; stopChecks: StopCheck[];
  status: DebateStatus; reason: string; rounds: number; answer: string | null;
  failure?: { code: DebateErrorCode; turnID?: string; debater?: Debater; attempts: number; validationFailures: number };
  points: Point[]; pointHistory: { turnID: string; points: Point[] }[];
  turns: Turn[]; startedAt: number; endedAt: number;
}
export type DebateEvent =
  | { type: "start"; assignment: DebateResult["assignment"] }
  | { type: "turn_start"; turn: Turn }
  | { type: "retry"; turnID: string; reason: string; delayMs: number }
  | { type: "validation_failure"; turnID: string; at: number; stage: "reply" | "missing_points"; reason: string; repair: boolean }
  | { type: "stop_check"; check: StopCheck }
  | { type: "end"; result: DebateResult };
export interface DebateOptions {
  question: string; context?: string; maxRounds: number; minRounds?: number; first: Debater | "random";
  callTimeoutMs: number; totalTimeoutMs: number;
  callModel: (debater: Debater, message: string, signal: AbortSignal) => Promise<{ text: string; reasoning?: string }>;
  onTurn?: (turn: Turn) => void; onEvent?: (event: DebateEvent) => void;
  signal?: AbortSignal; random?: () => number; now?: () => number;
}
export type DebateErrorCode = "call_timeout" | "total_timeout" | "cancelled" | "rate_limit" | "provider_unavailable" | "protocol" | "transport";
export class DebateError extends Error {
  constructor(public code: DebateErrorCode, message: string, public retryAfterMs?: number) {
    super(message); this.name = "DebateError";
  }
}
