import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, readFile, readlink, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tempRoot } from "./helpers/temp.ts";
const repo = path.resolve(".");
async function fixture() {
  const root = await tempRoot("install with spaces-");
  const config = path.join(root, "config/opencode");
  return { root, config, env: { ...process.env, XDG_CONFIG_HOME: path.dirname(config), HOME: root } };
}
function setup(f: Awaited<ReturnType<typeof fixture>>, mode = "--preview") {
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/setup-free.ts", mode], { cwd: repo, env: f.env, encoding: "utf8" });
}
test("free setup previews without writes, merges privately, repeats, and uninstalls only links", async () => {
  const f = await fixture();
  assert.equal(setup(f).status, 0);
  await assert.rejects(lstat(f.config), { code: "ENOENT" });
  await mkdir(f.config, { recursive: true });
  const file = path.join(f.config, "debate.config.json");
  const initial = { defaultMaxRounds: 2, logDir: "custom-log-path", backend: "openai-compatible", openaiCompatible: { apiKeyEnv: "MY_SECRET_ENV_NAME" } };
  await writeFile(file, JSON.stringify(initial));
  const preview = setup(f); assert.equal(preview.status, 0, preview.stderr);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), initial);
  const applied = setup(f, "--apply"); assert.equal(applied.status, 0, applied.stderr);
  const next = JSON.parse(await readFile(file, "utf8"));
  assert.equal(next.backend, "opencode"); assert.equal(next.readCompatibility, true);
  assert.equal(next.models.glm.modelID, "glm-5.3-flash-free"); assert.equal(next.models.deepseek.modelID, "deepseek-v4.1-flash-free");
  assert.equal(next.models.glm.variant, "low"); assert.equal(next.defaultMaxRounds, 2); assert.equal(next.logDir, initial.logDir);
  assert.equal(next.openaiCompatible.apiKeyEnv, initial.openaiCompatible.apiKeyEnv);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(await readlink(path.join(f.config, "plugins/opencode-debate")), repo);
  assert.equal(setup(f, "--apply").status, 0);
  const removed = spawnSync("bash", ["scripts/install.sh", "--uninstall"], { cwd: repo, env: f.env, encoding: "utf8" });
  assert.equal(removed.status, 0, removed.stderr);
  await assert.rejects(lstat(path.join(f.config, "plugins/opencode-debate")), { code: "ENOENT" });
  await assert.rejects(lstat(path.join(f.config, "commands/debate.md")), { code: "ENOENT" });
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), next);
});
test("free setup refuses unrelated links and invalid or symlinked configuration before any changes", async () => {
  for (const scenario of ["link", "invalid", "config-symlink"] as const) {
    const f = await fixture(); await mkdir(path.join(f.config, "plugins"), { recursive: true });
    const file = path.join(f.config, "debate.config.json");
    if (scenario === "link") { await writeFile(file, "{}"); await symlink("/unrelated", path.join(f.config, "plugins/opencode-debate")); }
    else if (scenario === "invalid") await writeFile(file, '{"unknownSecretField":"do-not-print-me"}');
    else { await writeFile(path.join(f.root, "target"), "{}"); await symlink(path.join(f.root, "target"), file); }
    const original = await readFile(file, "utf8");
    const result = setup(f, "--apply"); assert.notEqual(result.status, 0);
    assert.ok(!(result.stdout + result.stderr).includes("do-not-print-me"));
    assert.equal(await readFile(file, "utf8"), original);
    await assert.rejects(lstat(path.join(f.config, "commands/debate.md")), { code: "ENOENT" });
  }
});
