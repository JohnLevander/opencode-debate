import type { DebateConfig } from "../config.ts";
import type { DebateOptions, DebateResult, Debater } from "../core/types.ts";

export interface SessionDetail {
  debater: Debater; id: string; title: string; model: DebateConfig["models"][Debater]; role: "proposer" | "challenger";
}
export interface SessionInterruption {
  sessionID: string; requestedAt: number; acknowledgedAt?: number; interrupted?: boolean; error?: string;
}
export interface DebateAdapter {
  readonly sessions: SessionDetail[];
  readonly diagnostics: string[];
  readonly interruptions: SessionInterruption[];
  setAssignment(value: DebateResult["assignment"]): void;
  callModel: DebateOptions["callModel"];
  cancelAll(): Promise<void>;
  release(): void;
}
