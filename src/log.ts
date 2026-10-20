import { mkdir, open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
export function slugify(question: string): string {
  return question.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64).replace(/-$/, "") || "debate";
}
/** Serialized, atomic checkpoints; existing logs are never overwritten. */
export class DebateLog {
  readonly path: string;
  readonly slug: string;
  private queue: Promise<void> = Promise.resolve();
  private snapshot: Record<string, unknown>;
  constructor(logDir: string, question: string, initial: Record<string, unknown>, timestamp = new Date()) {
    this.slug = `${slugify(question)}-${randomUUID().slice(0, 8)}`;
    this.path = path.join(logDir, `${timestamp.toISOString()}-${this.slug}.json`);
    this.snapshot = { schemaVersion: 1, ...initial, status: "running" };
  }
  async initialize() {
    await mkdir(path.dirname(this.path), { recursive: true, mode: 0o700 });
    const file = await open(this.path, "wx", 0o600); await file.close();
    await this.update({});
  }
  update(patch: Record<string, unknown>): Promise<void> {
    this.snapshot = { ...this.snapshot, ...structuredClone(patch) };
    const contents = JSON.stringify(this.snapshot, null, 2) + "\n";
    const write = async () => {
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        const file = await open(temporary, "wx", 0o600);
        try { await file.writeFile(contents, "utf8"); await file.sync(); } finally { await file.close(); }
        await rename(temporary, this.path);
      } finally { await unlink(temporary).catch(() => {}); }
    };
    this.queue = this.queue.then(write, write); return this.queue;
  }
}
