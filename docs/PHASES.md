# Phase reports

## Phase 1 — deterministic core

Implemented `src/core/{types,parse,debate}.ts` and all model-facing text in `src/prompts.ts`. Added the complete user specification as `docs/SPEC.md`.

Validation: `npm run check` passes TypeScript and 19 scripted tests, covering the requested agreement, revision, stalemate, limits, malformed JSON, missing/unknown points, timeout retry prefix, double timeout, real/injected total deadlines, discarded late completion, cancellation, seeded assignment, and bounded rate-limit behavior.

The complete spec supersedes Phase 0's proposed mutual-acceptance/hash stop rules: termination uses Challenger endorsement and identical consecutive open-ID sets exactly as specified, always on a Challenger turn for normal completion. The spec also supersedes the earlier opt-in-only transcript logging proposal: full text and available reasoning will be logged, with no reasoning relayed to the opponent. There are no OpenCode imports in the engine. Failed and cancelled runs preserve the last valid answer and collected attempts.

No global files were changed. No inference was performed. Phase 2 will use the verified v2 input schema support and return `{ content: markdown }`, rather than a V1 raw-string executor return.

## Phase 2 — v2 plugin and adapter

Implemented the v2 `debate` tool, standard-schema Zod arguments, config layers/env overrides, two retained child sessions selected by model/agent at creation, separate final-text/reasoning extraction, hidden `debater` agent, tools removed from all debater model requests, engine-owned provider retries (including observed HTTP Retry-After hints), atomic private JSON logs, progress, and Markdown output/transcript. The global command's exact requested body is generated from `src/prompts.ts`. The installer defaults to a dry-run preview and refuses to replace unrelated files.

API conflicts resolved in favor of the pinned findings: the executor returns `{ content: markdown }` rather than a V1 string; Zod implements the supported Standard Schema interface and does not use the V1 tool helper. Child models use `{ providerID, id, variant? }`, and prompt input uses `text`. The plugin's directory has a root `index.ts` loader entrypoint. Cancellation explicitly interrupts children; ignored SDK request signals are not relied upon. A raw-operation barrier prevents a late prompt admission from overlapping the retry.

Verification so far: TypeScript and 39 tests pass, including full tool-path convergence, cancellation, and timeout logs; retained child sessions; no reasoning relay; missing/disabled models; invalid variants; stale/changed/truncated responses; and prompt-admission races. `bash -n scripts/install.sh` passes, and installation preview shows exactly two symlinks.

An isolated OpenCode 2.0.32 server, with config/cache/data/state/logs inside the ignored repository `.test-runtime/` tree, reports `opencode-debate` active. Registry reads confirm the `debater` agent is hidden, in subagent mode, with a deny-all permissions rule, and `/debate` has the requested description. No global installation or live inference has occurred. Phase 3's provider behavior, actual OpenChamber nesting, and UI cancellation remain unverified.

Phase 4 is deliberately not implemented. Its configuration is reserved and selecting it produces a clear logged error. Full reasoning/transcript logging follows the replacement specification, superseding Phase 0's proposed reduced logging.
