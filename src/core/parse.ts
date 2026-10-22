import { z } from "zod";
import type { Reply } from "./types.ts";
import { wellFormedUnicode } from "./unicode.ts";

const text = () => z.string().refine(wellFormedUnicode, "Text must contain well-formed Unicode");

const point = z.object({
  id: z.string().regex(/^C[1-9]\d*$/).max(12), summary: text().trim().min(1).max(10_000),
  status: z.enum(["open", "conceded", "defended", "resolved", "withdrawn"]), note: text().trim().min(1).max(50_000),
}).strict();
export const replySchema = z.object({
  answer: text().trim().min(1).max(200_000).nullable(), points: z.array(point).max(128),
  agrees_with_current_answer: z.boolean(), confidence: z.number().finite().min(0).max(1),
}).strict();

/** Detect a real unfinished root before a candidate, without treating inline prose as JSON. */
function unfinishedRoot(prefix: string): boolean {
  let depth = 0, quoted = false, escaped = false, lineStart = true;
  for (const char of prefix) {
    if (depth === 0) {
      if (char === "{" && lineStart) { depth = 1; lineStart = false; }
      else if (char === "\n" || char === "\r") lineStart = true;
      else if (char !== " " && char !== "\t") lineStart = false;
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}") depth--;
  }
  return depth !== 0;
}

/** Locate the final object backwards so broken prose/draft braces cannot absorb it. */
export function extractLastObject(text: string): string {
  if (text.length > 1_000_000) throw new Error("Reply exceeds the 1 MB parsing limit");
  const source = text.replace(/^\s*```(?:json)?\s*$/gim, "");
  let depth = 0, quoted = false, end = -1;
  for (let i = source.length - 1; i >= 0; i--) {
    const char = source[i];
    if (char === '"') {
      let escapes = 0;
      for (let j = i - 1; j >= 0 && source[j] === "\\"; j--) escapes++;
      if (escapes % 2 === 0) quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === "}") { if (depth === 0) end = i + 1; depth++; }
    else if (char === "{") {
      if (depth === 0) return source.slice(i); // trailing incomplete object, never an older answer
      if (--depth === 0) {
        // A completed inner reply inside a truncated wrapper is not a final root reply.
        const prefix = source.slice(0, i);
        if (/"(?:\\.|[^"\\])*"\s*:\s*$/.test(prefix) || unfinishedRoot(prefix)) throw new Error("Reply ends inside an incomplete JSON wrapper");
        return source.slice(i, end);
      }
    }
  }
  throw new Error("Reply contains no complete JSON object");
}
export function parseReply(text: string): Reply {
  const parsed = replySchema.parse(JSON.parse(extractLastObject(text)));
  if (new Set(parsed.points.map((p) => p.id)).size !== parsed.points.length) throw new Error("Duplicate point IDs");
  return parsed;
}
