import { spawn } from "node:child_process";
import type { DebateConfig } from "./config.ts";
import type { Verifier } from "./core/types.ts";
import { DebateError } from "./core/types.ts";
import { checkVerdictSchema } from "./core/verification.ts";

/** Trusted, locally configured checker; no shell interpolation or model-selected executable. */
export function commandVerifier(config: NonNullable<DebateConfig["verifier"]>, directory: string): Verifier {
  return { scope: config.scope, timeoutMs: config.timeoutMs, check: (input, signal) => new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const child = spawn(config.command[0], config.command.slice(1), {
      cwd: directory, shell: false, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"],
      // Avoid forwarding provider credentials or Node preload flags to a checker.
      env: { PATH: process.env.PATH, LANG: process.env.LANG, TZ: process.env.TZ },
    });
    let settled = false, bytes = 0; const chunks: Buffer[] = [];
    const kill = () => {
      try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* already exited */ }
    };
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return; settled = true;
      signal.removeEventListener("abort", abort); kill();
      if (error) reject(error); else {
        const parsed = checkVerdictSchema.safeParse(value);
        parsed.success ? resolve(parsed.data) : reject(new DebateError("verification", "Verifier returned an invalid verdict"));
      }
    };
    const abort = () => finish(signal.reason instanceof Error ? signal.reason : new DebateError("verification", "Verifier aborted"));
    const consume = (chunk: Buffer, stdout: boolean) => {
      bytes += chunk.length;
      if (bytes > 65_536) finish(new DebateError("verification", "Verifier output exceeded 64 KiB"));
      else if (stdout && !settled) chunks.push(chunk);
    };
    child.stdout.on("data", chunk => consume(chunk, true)); child.stderr.on("data", chunk => consume(chunk, false));
    child.on("error", () => finish(new DebateError("verification", "Cannot start the configured verifier")));
    child.stdin.on("error", () => { /* close/error handlers determine the verdict */ });
    child.on("close", code => {
      if (settled) return;
      if (code !== 0) { finish(new DebateError("verification", "Verifier exited unsuccessfully")); return; }
      let value: unknown;
      try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { finish(new DebateError("verification", "Verifier did not return a JSON verdict")); return; }
      finish(undefined, value);
    });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort(); else child.stdin.end(JSON.stringify(input));
  }) };
}
