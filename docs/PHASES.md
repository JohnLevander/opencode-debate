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


## Phase 3 — integration executed; free-model acceptance blocked

Installed the two approved global symlinks for the plugin and `/debate` command; no global JSON or agent file was edited. Tests ran first in an isolated OpenCode environment, then through OpenChamber. The full [integration report](INTEGRATION.md) records session IDs, logs, point histories, scope, and screenshot evidence.

The IEEE and contested live cases both failed during P0 with FreeTierError, producing clean error logs with zero Challenger rounds and empty point histories. The IEEE case was tried with each model proposing. Neither expected convergence nor meaningful multi-round disagreement was achieved. This matches the upstream free-tier/no-tools issue linked in the report. The hidden agent retains all tools disabled as required.

A 1000 ms timeout test and an actual OpenChamber Stop test passed using an isolated pre-dispatch delay. The timeout retried once with the required prefix and returned an error log. UI Stop produced a cancelled log and explicit interrupt acknowledgments for both children; only the active Proposer needed stopping. The parent was responsive and both retained children appeared under Subagents. No tested path deadlocked, but successful provider-driven multi-round execution remains blocked. The delay fixture was disabled afterward.

Live testing also prompted default-variant normalization, preservation of host-assembled system context, and per-child interruption audit records. TypeScript and all 40 automated tests pass. The README covers installation/uninstallation, configuration, pending fallback selection, logs, prompt tuning, and observed limitations.

Stopped before Phase 4 as requested. The fallback configuration still reports an unimplemented-backend error. Implementation of that adapter awaits approval; no paid inference is authorized or performed by this phase.


## Phase 4 — OpenAI-compatible fallback

Implemented `src/adapters/openai-compatible.ts`, selectable with `backend: "openai-compatible"`. It uses fetch with the engine's abort signal, distinct in-memory histories, the shared debater system prompt, and configured model IDs. The default remains the OpenCode backend. The fallback sends non-streaming text-only chat completions with no tools, separates reasoning for logging, rejects incomplete/tool-call/refusal replies, and maps rate-limit responses plus Retry-After into the existing deterministic engine. It performs no internal retries. Completed malformed debate JSON remains in its own history for repair; failed/aborted HTTP requests and late results cannot contaminate history.

The plugin selects either adapter behind a shared interface. Markdown and transcripts show the selected fallback model IDs and explicitly report that no child sessions exist. Fallback logs retain the same full turn/point/result data, while interrupt-session records are empty because cancellation targets fetch requests. Model/key-environment/endpoint overrides are documented. URLs cannot embed credentials or query secrets, API keys are read only from the server environment, redirects are rejected, and provider error bodies are not included in errors. README setup and known limitations now cover the implemented backend.

Validation: `npm run check` passes TypeScript and 57 tests (40 previous plus 17 fallback tests). Local mock-server tests cover authenticated request shape and exact model IDs, isolated histories, all supported reasoning fields with no replay/relay, missing credentials, invalid response forms, sanitized HTTP errors, 429/equivalent envelopes and Retry-After, body-read abort/disconnection, cancellation of both active transports, late results with ignored aborts, timeout retry prefix, double timeout, total deadline, malformed JSON repair, configuration validation/env overrides, and full tool-path logs for convergence, partial cancellation, rate-limit recovery, and missing keys. SDK methods deliberately throw in fallback tool tests, proving the backend does not accidentally create OpenCode children or query its model registry.

Only local mock inference was used. No paid requests, real API key access, global configuration edits, service restarts, or further global installation changes occurred. Phase 3's free-provider blocker remains; production fallback inference and real-model convergence are unverified. The existing approved installation links already point at the repository; restart the host to load the updated code and configure fallback explicitly before using it.

API references checked for this implementation: [OpenRouter chat completions](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion), [reasoning fields](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), and [public model inventory](https://openrouter.ai/api/v1/models). The inventory listed the two specified fallback IDs on 2026-10-20; availability was not inferred from model names or tested through paid requests.


## Free-only follow-up — approved restricted-read compatibility mode

The user reaffirmed free-only operation and approved testing native read restricted to one plugin-owned empty file, while keeping every other tool denied. Implemented default-off `readCompatibility`, a tracked empty asset, child-scoped permission overrides, context filtering, and a second execution guard. The guard verifies the exact file, zero-byte regular-file status, no symlink substitution, and no nearby AGENTS.md discovery. Strict mode and parent tools retain their prior behavior. Reasoning/role assignment/protocol/retry/deadline control is unchanged. No API key, paid requests, provider-policy changes, or fabricated tool definitions are involved.

The isolated real engine debate and the actual installed debate tool both converged on IEEE 754 at C1 with the specified free models. The installed tool ran through OpenChamber's server; its converged result was inspected in the UI and captured. Two transient 429 failures recovered within the successful opening turn; an earlier run exhausted its bounded attempts cleanly. Real permission audits denied shell, canary reads, and directory reads while allowing only the empty asset. No debater tool was executed in the successful IEEE test. The [integration report](INTEGRATION.md) records exact sessions/logs and scope.

Validation: TypeScript and 66 automated tests pass, including seven new compatibility checks. Configuration is opt-in and recorded in logs; the global configuration still has only backend opencode, awaiting a separately previewed external edit before general enablement. The exception supersedes the original no-tool requirement only when expressly enabled. The paid fallback remains available in code but is not selected or used.

The contested free-model test reached seven substantive Challenger objections but ended with a clean partial error when GLM's Proposer repair used the wrong role schema and no answer. The last valid proposal and seven open points remain in the log/result. Successful contested multi-round convergence/stalemate remains unverified; this is recorded as an output-protocol failure rather than hidden by extra retries. Both repo-local experiment fixtures were disabled after testing, and the successful IEEE caller/children reported zero cost.


## Approved global activation

The user approved the exact merge into `~/.config/opencode/debate.config.json`: backend `opencode`, readCompatibility `true`. The file was updated atomically with mode 0600, preserving other fields. Effective configuration verification selected the two original free model IDs. OpenChamber reported no active sessions before its OpenCode server was restarted through Settings. After restart, the server reported 2.0.32, both `opencode-debate` and `free-only` were active, and the hidden subagent `debater` was registered. No API key, provider-policy change, paid backend, or automatic paid substitution was introduced.


## Code Mode discovery correction

The user's code-review caller searched Code Mode and declared debate absent despite the plugin being active in that session's project. The earlier registration used codemode false, which excludes a direct tool from Code Mode search. Changed debate to a pinned Code Mode registration and updated the centralized command to request immediate invocation, pass supplied attachments as context, await the discovered callable, and avoid a simulated substitute. Child restrictions and deterministic orchestration are unchanged.

The registration regression test passes. A separate isolated OpenCode 2.0.32 context probe confirmed codemode true/pinned true and the debate signature in assembled catalog instructions, with execute advertised; it deliberately aborted before inference. No global file changes or new model requests were needed. The caller's failed code-review attempt created no debate log. Parent provider retries are separate from the engine's bounded retry budget.


## Requested minimum rounds

Added optional tool `min_rounds` and pure-engine `minRounds`, default 1. Convergence and repeated-open-ID stalemate checks are gated by that minimum; the engine continues alternating full proposals and reviews until it is reached. Three rounds means three turns each, counting P0: P0/C1/P1/C2/P2/C3. Cancellation, transport/protocol errors, and call/total deadlines retain priority. Invalid ranges, including a minimum greater than the effective maximum, fail before any model call. Prompts allow an unchanged answer when independent rechecking reveals no new objection; the minimum does not require invented disagreement.

Validation covers early agreement, repeated objections, a new objection after prior agreement at the min/max boundary, invalid bounds with no calls, early cancellation/provider errors, and full plugin log/adapter propagation. Existing default behavior remains covered. This feature has deterministic scripted coverage; no additional live-model debate was run to force a minimum-length exchange.


Minimum-round verification: TypeScript and all 73 tests pass (including the two friend-setup tests). OpenChamber's OpenCode server had zero active sessions, so locations were reloaded without editing any global file. A temporary repo-local audit hook on that server confirmed registered codemode true/pinned true, execute advertised, and both debate and min_rounds in the assembled catalog instructions. It stopped before inference; its local .opencode fixture was disabled afterward. This verifies active-server exposure, not model compliance or a new successful debate.
