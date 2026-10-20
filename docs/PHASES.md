# Phase reports

## Phase 1 — deterministic core

Implemented `src/core/{types,parse,debate}.ts` and all model-facing text in `src/prompts.ts`. Added the complete user specification as `docs/SPEC.md`.

Validation: `npm run check` passes TypeScript and 19 scripted tests, covering the requested agreement, revision, stalemate, limits, malformed JSON, missing/unknown points, timeout retry prefix, double timeout, real/injected total deadlines, discarded late completion, cancellation, seeded assignment, and bounded rate-limit behavior.

The complete spec supersedes Phase 0's proposed mutual-acceptance/hash stop rules: termination uses Challenger endorsement and identical consecutive open-ID sets exactly as specified, always on a Challenger turn for normal completion. The spec also supersedes the earlier opt-in-only transcript logging proposal: full text and available reasoning will be logged, with no reasoning relayed to the opponent. There are no OpenCode imports in the engine. Failed and cancelled runs preserve the last valid answer and collected attempts.

No global files were changed. No inference was performed. Phase 2 will use the verified v2 input schema support and return `{ content: markdown }`, rather than a V1 raw-string executor return.
