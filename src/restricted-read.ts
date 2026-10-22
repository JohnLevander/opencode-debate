import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "@opencode/plugin";
import { EMPTY_READ_NOTICE } from "./prompts.ts";
import { DebateError } from "./core/types.ts";

const emptyFile = fileURLToPath(new URL("../assets/compatibility/empty.txt", import.meta.url));
type Rule = { action: string; resource: string; effect: "allow" | "deny" };
export type RestrictedReads = Map<string, RestrictedRead>;
export const MAX_FORBIDDEN_TOOL_CALLS = 3;

/** Only the genuine built-in read tool, bounded by permissions and an execution guard. */
export class RestrictedRead {
  private turns = new Map<string, { controller: AbortController; denials: number }>();
  private constructor(readonly file: string, readonly directory: string, readonly permissions: Rule[]) {}
  beginTurn(sessionID: string, controller: AbortController): void { this.turns.set(sessionID, { controller, denials: 0 }); }
  endTurn(sessionID: string, controller: AbortController): void {
    if (this.turns.get(sessionID)?.controller === controller) this.turns.delete(sessionID);
  }
  static async create(directory: string, target = emptyFile): Promise<RestrictedRead> {
    const initial = await lstat(target);
    if (!initial.isFile() || initial.isSymbolicLink()) throw new Error("Compatibility read file must be a regular file, not a symlink");
    const file = await realpath(target);
    const slash = (value: string) => value.split(path.sep).join("/");
    const policy = new RestrictedRead(file, path.resolve(directory), [
      { action: "*", resource: "*", effect: "deny" },
      // Native read requires this directory authorization for files outside the project.
      // Read permissions and the execution guard still forbid every other file/directory.
      { action: "external_directory", resource: `${slash(path.dirname(file))}/*`, effect: "allow" },
      { action: "read", resource: slash(file), effect: "allow" },
      { action: "read", resource: slash(path.relative(directory, file)), effect: "allow" },
    ]);
    await policy.verify();
    return policy;
  }
  async verify(): Promise<void> {
    const stat = await lstat(this.file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 0 || await realpath(this.file) !== this.file) {
      throw new Error("Compatibility read file changed: it must remain an empty regular file");
    }
    // Native read may discover AGENTS.md after an internal read. Refuse that
    // side effect rather than allow any additional file content into the session.
    for (let directory = path.dirname(this.file); ; directory = path.dirname(directory)) {
      try {
        await lstat(path.join(directory, "AGENTS.md"));
        throw new Error("Compatibility read refused: nearby AGENTS.md could be loaded by the built-in read tool");
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (path.dirname(directory) === directory) break;
    }
  }
  async assertCall(tool: string, input: unknown, sessionID?: string): Promise<void> {
    try {
      const requested = input && typeof input === "object" && "path" in input ? input.path : undefined;
      if (tool !== "read" || typeof requested !== "string" || path.resolve(this.directory, requested) !== this.file) {
        throw new Error("Debater tools are restricted to reading the plugin-owned empty file");
      }
      await this.verify();
    } catch (error) {
      const turn = sessionID === undefined ? undefined : this.turns.get(sessionID);
      if (turn && ++turn.denials >= MAX_FORBIDDEN_TOOL_CALLS && !turn.controller.signal.aborted) {
        turn.controller.abort(new DebateError("protocol", `Debater repeatedly attempted forbidden tools (${turn.denials} denied calls); native turn interrupted`));
      }
      throw error;
    }
  }
}

export async function registerToolIsolation(ctx: Plugin.Context, owned: Set<string>, reads: RestrictedReads): Promise<void> {
  await ctx.session.hook("context", async event => {
    if (event.agent !== "debater" && !owned.has(event.sessionID)) return;
    const policy = reads.get(event.sessionID);
    for (const tool of Object.keys(event.tools)) if (!policy || tool !== "read") delete event.tools[tool];
    if (policy) {
      await policy.verify();
      if (!event.tools.read) throw new Error("Compatibility mode requires the built-in read tool, but it is unavailable");
      event.system.push({ type: "text", text: EMPTY_READ_NOTICE });
    }
  });
  // Also reject execution if another hook later re-adds or renames a tool.
  await ctx.tool.hook("execute.before", async event => {
    if (event.agent !== "debater" && !owned.has(event.sessionID)) return;
    const policy = reads.get(event.sessionID);
    if (!policy) throw new Error("Debater tools are disabled");
    await policy.assertCall(event.tool, event.input, event.sessionID);
  });
}
