import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { configSchema, defaults } from "../src/config.ts";
import { RestrictedRead } from "../src/restricted-read.ts";

async function main() {
  const mode = process.argv[2] ?? "--preview";
  if (!["--preview", "--apply"].includes(mode) || process.argv.length > 3) throw new Error("Usage: node --import tsx scripts/setup-free.ts [--preview | --apply]");
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Node.js 24 or newer is required; OpenCode compatibility was tested with 2.0.32.");
  const repo = await realpath(fileURLToPath(new URL("..", import.meta.url)));
  const file = path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"), "opencode/debate.config.json");
  let current: Record<string, unknown> = {};
  let original: string | undefined;
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Existing debate config must be a regular file, not a symlink");
    original = await readFile(file, "utf8");
    const parsed: unknown = JSON.parse(original);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object");
    current = parsed as Record<string, unknown>;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const next = { ...current, backend: "opencode", readCompatibility: true,
    models: { glm: { providerID: "opencode", modelID: "glm-5.3-flash-free", variant: "low" },
      deepseek: { providerID: "opencode", modelID: "deepseek-v4.1-flash-free", variant: "low" } } };
  // Validate existing unrelated settings too, before printing or changing anything.
  const base = defaults();
  const fallback = current.openaiCompatible as Partial<typeof base.openaiCompatible> | undefined;
  configSchema.parse({ ...base, ...next, openaiCompatible: { ...base.openaiCompatible, ...fallback,
    models: { ...base.openaiCompatible.models, ...fallback?.models } } });
  await RestrictedRead.create(repo);
  const install = (arg: string) => {
    const result = spawnSync("bash", [path.join(repo, "scripts/install.sh"), arg], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr.trim() || result.error?.message || "Link installer failed");
    return result.stdout;
  };
  const links = install("--dry-run"); // Check both link conflicts before mutating the config.
  console.log(links.trim());
  console.log(`\n${original === undefined ? "Create" : "Replace (preserving other fields)"}: ${file} (mode 0600)\n${JSON.stringify(next, null, 2)}`);
  console.log("\nNo API key, provider-policy changes, or automatic paid fallback. Project config and server environment can override these settings. Choose a Free calling model in OpenChamber too.");
  if (mode === "--preview") { console.log("Preview only; no files changed. Review the paths and JSON, then rerun with --apply to approve these changes."); return; }
  // Refuse a stale preview if the file changed during validation.
  let latest: string | undefined;
  try { latest = await readFile(file, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (latest !== original) throw new Error("Configuration changed during setup; preview again");
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: "wx" }); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
  console.log(install("--apply").trim());
  console.log("Free setup applied. Restart OpenCode in OpenChamber Settings → General, then try /debate in a new chat. Keep this repository at its current path.");
}
main().catch(error => { console.error(`Free setup failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
