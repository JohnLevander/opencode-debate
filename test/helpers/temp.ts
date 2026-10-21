import { rmSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";

// Test fixtures create many temp directories; remove this process's directories at exit so
// .test-runtime does not accumulate. Other test files run in separate processes with their
// own tracked roots, so cleanup never races in-flight suites.
const roots: string[] = [];
process.once("exit", () => { for (const root of roots) { try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ } } });

export async function tempRoot(prefix: string): Promise<string> {
  await mkdir(".test-runtime", { recursive: true });
  const root = await mkdtemp(path.resolve(`.test-runtime/${prefix}`));
  roots.push(root);
  return root;
}
