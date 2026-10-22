import { test } from "node:test";
import assert from "node:assert/strict";
import { Message } from "@opencode/ai";
import { resultWithOriginal, withoutOriginalAttachments } from "../src/result.ts";

test("original Markdown stays intact in stored tool output while model context uses text only", () => {
  const markdown = "## Debate result: converged\n汉😀\n### Transcript\n```json\n{\"answer\":null}\n```";
  const result = resultWithOriginal(markdown);
  assert.ok(Array.isArray(result.content));
  const stored = Message.tool({ id: "call-1", name: "execute", result: { type: "content", value: result.content } });
  const before = JSON.stringify(stored);
  const [model] = withoutOriginalAttachments([stored]);
  assert.ok(model instanceof Message); assert.notEqual(model, stored);
  assert.equal(JSON.stringify(stored), before);
  const part = model.content[0]; assert.equal(part.type, "tool-result");
  if (part.type !== "tool-result" || part.result.type !== "content") throw new Error("Missing tool result");
  assert.ok(part.result.value.every(item => item.type === "text"));
  assert.equal(part.result.value[0].type === "text" && part.result.value[0].text, markdown);
  assert.match(part.result.value[1].type === "text" ? part.result.value[1].text : "", /original result is attached/);
  assert.ok(Array.isArray(result.content) && result.content.some(item => item.type === "file"));
});

test("unrelated or renamed/tampered files are not removed from model context", () => {
  const markdown = "## Debate result: converged\nOriginal text";
  const result = resultWithOriginal(markdown); assert.ok(Array.isArray(result.content));
  const file = result.content.find(item => item.type === "file")!;
  for (const item of [{ ...file, name: "notes.md" }, { ...file, name: "debate-result-000000000000.md" },
    { ...file, uri: "data:text/markdown;base64," + Buffer.from("different text").toString("base64") }]) {
    const message = Message.tool({ id: "call-1", name: "other", result: { type: "content", value: [item] } });
    assert.equal(withoutOriginalAttachments([message])[0], message);
  }
});
