import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";

/** Files under this directory of the session's location can be passed by name as exact context bytes. */
export const CONTEXT_DIR = path.join(".opencode", "debate-context");
export const MAX_CONTEXT_CHARS = 300_000;
// UTF-8 needs at most 4 bytes per UTF-16 code unit pair, so this bounds the read before decoding.
const MAX_CONTEXT_BYTES = MAX_CONTEXT_CHARS * 4;

export interface ContextSource { kind: "inline" | "file"; file?: string; bytes: number; sha256: string; expectedSha256?: string }
export interface ResolvedContext { context?: string; source?: ContextSource }
export interface ContextArgs { context?: string; context_file?: string; context_sha256?: string }

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/**
 * The calling model retypes an inline `context`, which can silently alter it. `context_file` names a file
 * under CONTEXT_DIR whose bytes are read here unchanged; `context_sha256` makes either form fail closed
 * unless the context the debaters would see hashes to the expected value. Only CONTEXT_DIR is readable,
 * so a calling model cannot send arbitrary local files to the providers.
 */
export async function resolveContext(directory: string, args: ContextArgs): Promise<ResolvedContext> {
  if (args.context !== undefined && args.context_file !== undefined) throw new Error("Pass either context or context_file, not both");
  let context: string | undefined; let bytes: Uint8Array | undefined; let file: string | undefined;
  if (args.context_file !== undefined) {
    if (path.isAbsolute(args.context_file)) throw new Error(`context_file must be a path relative to ${CONTEXT_DIR}`);
    let base: string;
    try { base = await realpath(path.join(directory, CONTEXT_DIR)); }
    catch { throw new Error(`context_file requires the directory ${path.join(directory, CONTEXT_DIR)}`); }
    let target: string;
    try { target = await realpath(path.resolve(base, args.context_file)); }
    catch { throw new Error(`context_file not found: ${args.context_file} (looked in ${base})`); }
    // realpath resolves symlinks, so a link inside CONTEXT_DIR that points elsewhere is rejected too.
    if (!target.startsWith(base + path.sep)) throw new Error(`context_file must stay inside ${CONTEXT_DIR}`);
    // Refuse FIFOs and devices before opening (a FIFO would block the open), then re-check the opened handle.
    if (!(await stat(target)).isFile()) throw new Error(`context_file is not a regular file: ${args.context_file}`);
    const handle = await open(target, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new Error(`context_file is not a regular file: ${args.context_file}`);
      if (info.size > MAX_CONTEXT_BYTES) throw new Error(`context_file is larger than ${MAX_CONTEXT_BYTES} bytes`);
      bytes = await handle.readFile();
    } finally { await handle.close(); }
    try { context = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new Error(`context_file is not valid UTF-8: ${args.context_file}`); }
    if (context.length > MAX_CONTEXT_CHARS) throw new Error(`context_file exceeds ${MAX_CONTEXT_CHARS} characters`);
    file = path.relative(directory, target);
  } else if (args.context !== undefined) {
    context = args.context; bytes = Buffer.from(context, "utf8");
  }
  if (context === undefined || bytes === undefined) {
    if (args.context_sha256 !== undefined) throw new Error("context_sha256 was given without context or context_file");
    return {};
  }
  const digest = sha256(bytes);
  const expected = args.context_sha256?.toLowerCase();
  if (expected !== undefined && expected !== digest)
    throw new Error(`Context SHA-256 mismatch: expected ${expected}, received ${digest} (${bytes.length} bytes${file ? ` from ${file}` : ", inline"}). The context was altered before reaching the tool; nothing was sent to the debaters.`);
  return { context, source: { kind: file ? "file" : "inline", ...(file ? { file } : {}), bytes: bytes.length, sha256: digest, ...(expected ? { expectedSha256: expected } : {}) } };
}
