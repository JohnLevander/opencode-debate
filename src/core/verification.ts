import { z } from "zod";
import { wellFormedUnicode } from "./unicode.ts";

/** Only a trusted verifier returns this envelope; model replies cannot supply it. */
export const checkVerdictSchema = z.object({
  status: z.enum(["passed", "failed", "inconclusive"]),
  summary: z.string().trim().min(1).max(10_000).refine(wellFormedUnicode),
  checksRun: z.number().int().min(0).max(1_000_000),
}).strict().refine(value => value.status !== "passed" || value.checksRun > 0, "A pass requires at least one executed check");

