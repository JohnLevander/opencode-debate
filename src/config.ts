import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
const model = z.object({ providerID: z.string().min(1), modelID: z.string().min(1), variant: z.string().min(1).optional() }).strict();
export const configSchema = z.object({
  backend: z.enum(["opencode", "openai-compatible"]),
  readCompatibility: z.boolean().default(false),
  models: z.object({ glm: model, deepseek: model }).strict(),
  defaultMaxRounds: z.number().int().min(1).max(8),
  callTimeoutMs: z.number().int().min(1).max(2_147_483_647),
  totalTimeoutMs: z.number().int().min(1).max(2_147_483_647),
  logDir: z.string().min(1),
  openaiCompatible: z.object({
    baseURL: z.url().refine(value => {
      try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
      } catch { return false; }
    }, "Use an HTTP(S) API base URL without credentials, query, or fragment"),
    apiKeyEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    models: z.object({ glm: z.string().min(1), deepseek: z.string().min(1) }).strict(),
  }).strict(),
}).strict();
export type DebateConfig = z.infer<typeof configSchema>;
export function defaults(env: NodeJS.ProcessEnv = process.env): DebateConfig {
  return {
    backend: "opencode", readCompatibility: false, models: { glm: { providerID: "opencode", modelID: "glm-5.3-flash-free" }, deepseek: { providerID: "opencode", modelID: "deepseek-v4.1-flash-free" } },
    defaultMaxRounds: 4, callTimeoutMs: 300_000, totalTimeoutMs: 1_800_000,
    logDir: path.join(env.XDG_DATA_HOME ?? path.join(homedir(), ".local/share"), "opencode-debate/debates"),
    openaiCompatible: { baseURL: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY", models: { glm: "z-ai/glm-5.3-flash", deepseek: "deepseek/deepseek-v4.1-flash" } },
  };
}
function merge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") throw new Error("Invalid configuration key");
    result[key] = value && typeof value === "object" && !Array.isArray(value) && base[key] && typeof base[key] === "object"
      ? merge(base[key] as Record<string, unknown>, value as Record<string, unknown>) : value;
  }
  return result;
}
export async function loadConfig(directory: string, projectRoot = directory, env: NodeJS.ProcessEnv = process.env): Promise<DebateConfig> {
  const globalFile = path.join(env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"), "opencode/debate.config.json");
  const directories = [path.resolve(directory)];
  const root = path.resolve(projectRoot);
  while (directories.at(-1) !== root && path.dirname(directories.at(-1)!) !== directories.at(-1)) {
    const parent = path.dirname(directories.at(-1)!);
    if (!path.relative(root, parent).startsWith("..")) directories.push(parent); else break;
  }
  const files = [globalFile, ...directories.reverse().map(d => path.join(d, ".opencode/debate.config.json"))];
  let config: Record<string, unknown> = defaults(env);
  for (const file of files) {
    let contents: string;
    try { contents = await readFile(file, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    try {
      const parsed = JSON.parse(contents);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object");
      config = merge(config, parsed);
    } catch (error) { throw new Error(`Invalid debate configuration ${file}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const overrides: Record<string, unknown> = {};
  for (const [suffix, field] of [["BACKEND", "backend"], ["LOG_DIR", "logDir"]] as const) if (env[`OPENCODE_DEBATE_${suffix}`]) overrides[field] = env[`OPENCODE_DEBATE_${suffix}`];
  for (const [suffix, field] of [["MAX_ROUNDS", "defaultMaxRounds"], ["CALL_TIMEOUT_MS", "callTimeoutMs"], ["TOTAL_TIMEOUT_MS", "totalTimeoutMs"]] as const) if (env[`OPENCODE_DEBATE_${suffix}`]) overrides[field] = Number(env[`OPENCODE_DEBATE_${suffix}`]);
  for (const debater of ["glm", "deepseek"] as const) {
    const patch: Record<string, unknown> = {};
    for (const [suffix, field] of [["PROVIDER_ID", "providerID"], ["MODEL_ID", "modelID"], ["VARIANT", "variant"]] as const) {
      const value = env[`OPENCODE_DEBATE_${debater.toUpperCase()}_${suffix}`]; if (value) patch[field] = value;
    }
    if (Object.keys(patch).length) overrides.models = { ...(overrides.models as object), [debater]: patch };
  }
  if (env.OPENCODE_DEBATE_READ_COMPATIBILITY !== undefined) {
    if (!["true", "false"].includes(env.OPENCODE_DEBATE_READ_COMPATIBILITY)) throw new Error("OPENCODE_DEBATE_READ_COMPATIBILITY must be true or false");
    overrides.readCompatibility = env.OPENCODE_DEBATE_READ_COMPATIBILITY === "true";
  }
  const fallback: Record<string, unknown> = {};
  if (env.OPENCODE_DEBATE_BASE_URL) fallback.baseURL = env.OPENCODE_DEBATE_BASE_URL;
  if (env.OPENCODE_DEBATE_FALLBACK_API_KEY_ENV) fallback.apiKeyEnv = env.OPENCODE_DEBATE_FALLBACK_API_KEY_ENV;
  for (const debater of ["glm", "deepseek"] as const) {
    const value = env[`OPENCODE_DEBATE_FALLBACK_${debater.toUpperCase()}_MODEL_ID`];
    if (value) fallback.models = { ...(fallback.models as object), [debater]: value };
  }
  if (Object.keys(fallback).length) overrides.openaiCompatible = fallback;
  const result = configSchema.parse(merge(config, overrides));
  result.logDir = result.logDir.startsWith("~/") ? path.join(homedir(), result.logDir.slice(2)) : path.resolve(directory, result.logDir);
  return result;
}
