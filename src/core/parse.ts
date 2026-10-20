import { z } from "zod";
import type { Reply } from "./types.ts";

const point = z.object({
  id: z.string().regex(/^C[1-9]\d*$/).max(12), summary: z.string().trim().min(1).max(10_000),
  status: z.enum(["open", "conceded", "defended", "resolved", "withdrawn"]), note: z.string().trim().min(1).max(50_000),
}).strict();
export const replySchema = z.object({
  answer: z.string().trim().min(1).max(200_000).nullable(), points: z.array(point).max(128),
  agrees_with_current_answer: z.boolean(), confidence: z.number().finite().min(0).max(1),
}).strict();

/** Read the last balanced outer object, respecting braces inside JSON strings. */
export function extractLastObject(text: string): string {
  if (text.length > 1_000_000) throw new Error("Reply exceeds the 1 MB parsing limit");
  const source = text.replace(/^\s*```(?:json)?\s*$/gim, "");
  let last: string | undefined;
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== "{") continue;
    const start = i; let depth = 0, quoted = false, escaped = false, end = -1;
    for (let j = i; j < source.length; j++) {
      const char = source[j];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) { end = j; break; }
    }
    // A trailing incomplete object must not silently fall back to an older answer.
    if (end === -1) { last = source.slice(start); break; }
    last = source.slice(start, end + 1); i = end;
  }
  if (!last) throw new Error("Reply contains no JSON object");
  return last;
}
export function parseReply(text: string): Reply {
  const parsed = replySchema.parse(JSON.parse(extractLastObject(text)));
  if (new Set(parsed.points.map((p) => p.id)).size !== parsed.points.length) throw new Error("Duplicate point IDs");
  return parsed;
}
