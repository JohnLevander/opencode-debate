import { createHash } from "node:crypto";
import type { Result } from "@opencode/plugin/promise/tool";
import type { Message } from "@opencode/ai";
import { escapeInvalidUnicode } from "./core/unicode.ts";

/** Code Mode collects file parts separately from the calling model's returned text. */
export function originalResultInfo(markdown: string) {
  const bytes = Buffer.from(escapeInvalidUnicode(markdown), "utf8");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const name = `debate-result-${sha256.slice(0, 12)}.md`;
  return { name, sha256, bytes: bytes.length };
}
export function resultWithOriginal(markdown: string): Result {
  markdown = escapeInvalidUnicode(markdown);
  const originalResult = originalResultInfo(markdown);
  return {
    content: [
      { type: "text", text: markdown },
      { type: "file", uri: `data:text/markdown;base64,${Buffer.from(markdown, "utf8").toString("base64")}`, mime: "text/markdown", name: originalResult.name },
    ],
    metadata: { originalResult, verification: "not_independently_verified" },
  };
}

/** Keep the attachment in stored/UI content, but do not send Markdown as provider media. */
export function withoutOriginalAttachments(messages: Message[]): Message[] {
  return messages.map(message => {
    if (message.role !== "tool") return message;
    let changed = false;
    const content = message.content.map(part => {
      if (part.type !== "tool-result" || part.result.type !== "content") return part;
      const value = part.result.value.map(item => {
        if (item.type !== "file" || item.mime !== "text/markdown" || !/^debate-result-[a-f0-9]{12}\.md$/.test(item.name ?? "") || !item.uri.startsWith("data:text/markdown;base64,")) return item;
        const markdown = Buffer.from(item.uri.slice("data:text/markdown;base64,".length), "base64").toString("utf8");
        if (!markdown.startsWith("## Debate result:") || originalResultInfo(markdown).name !== item.name) return item;
        changed = true;
        return { type: "text" as const, text: `The original result is attached in the conversation as ${item.name}. Use the accompanying result text; preserve the verification notice and refer to the attachment for the exact transcript.` };
      });
      return { ...part, result: { ...part.result, value } };
    });
    // Reuse the host's Message class; do not load a second copy of the host runtime.
    return changed ? new (message.constructor as typeof Message)({ ...message, content }) : message;
  });
}
