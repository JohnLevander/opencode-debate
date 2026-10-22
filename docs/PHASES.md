# Phase reports

Current source status, 2026-10-22: all four phases and the approved follow-ups are implemented. `npm run check` passes TypeScript and 281 tests. The sections below preserve results at each milestone, including historical test counts and approval boundaries. See the final sections for maximum-round testing, the timer fix, the [ten-risk failure audit](FAILURE_AUDIT.md), and [independent verification](VERIFICATION.md), and [README.md](../README.md) for current setup and behavior.

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


## Requested contribution winner line

Added a pure deterministic retained-phrases-v1 scorer and a result line reporting a contribution winner/tie/undetermined with both word counts. It credits normalized final-answer words covered by matching five-word phrases (at least three non-stop words) to the first valid answer/point introducing them, excluding supplied question/context. Counts, method, basis, and winner are logged. Error/cancelled partial answers never declare a winner. Scoring has no effect on protocol control and makes no extra model calls.

This is explicitly a text-reuse estimate: paraphrases are not semantically attributed, and retained opening content favors its original Proposer. Tests cover adopted Challenger wording, earliest-source credit despite repetition/casing, provided context, ties, short/unmatched text, paraphrases, invalid replies, and incomplete outcomes. Plugin integration checks result rendering and persistent score metadata.


## Live city-debate repair and logging follow-up

The user's city-comparison run (log suffix e42fe756) returned error after C1 because GLM introduced C1/C2 already resolved while agreeing with the proposal. The strict protocol correctly rejected those IDs, but ID/status checks happened after the reply-repair path, causing an immediate stop. Moved immutable Challenger validation inside the single repair path; only a validated reply can mutate canonical IDs/statuses. The repair prompt includes the actual error and role, next unused ID and known IDs; initial critique guidance puts checked-correct observations in prose rather than new resolved points. Two invalid replies still stop cleanly. Proposer repair now explicitly requires a full answer and retains the Proposer role. No reply is silently normalized into agreement.

Errors/cancellation now label retained output partial/incomplete; non-converged normal endings use current answer. An empty point list explicitly does not establish agreement. The caller's tool description asks it to preserve the completion status and contribution line. Added structured validationFailures checkpoints and per-review stopChecks, plus resolved limits; private existing logs retain raw attempts and reasoning separately. No additional model request or paid backend was used for this fix. Regression tests reproduce the rejected resolved-point pattern, successful bounded repair, failed second repair, atomic IDs, role guidance, and persistent log/output semantics.


Validation after the repair/logging changes: npm run check passes TypeScript and all 84 tests. Provider availability and successful contested multi-round live-model execution remain separate from these deterministic regression checks.


## Friends installation and release packaging

Added docs/INSTALL.md, npm run setup:free preview/apply, and npm run release:zip. The free preset selects only the original two free model IDs with low variants, enables the tested restricted-read mode, preserves other validated debate fields, writes mode 0600 atomically, and uses the existing conflict-refusing link installer. Preview performs no writes. Setup does not modify credentials, OpenCode provider policies, or opencode.json(c); project/server overrides remain explicitly documented. The caller must select a Free model too. Installation is not an account-wide free-provider policy.

Two temporary-home/config tests cover no-write preview, field preservation, private permissions, paths with spaces, repeated installation, matching-link uninstall, and refusal of unrelated/broken links, invalid JSON fields, and symlinked config. npm run check passes TypeScript and all 84 tests. Bash scripts pass syntax checks. The release script requires a clean committed checkout and archives tracked source plus lockfile into a ZIP with a SHA-256 checksum. Dependencies, local test/runtime logs, credentials, caches, and Git history are absent from the package. No public GitHub repository is created or pushed by these scripts.


## Public GitHub distribution

The user authorized publishing JohnLevander/opencode-debate as a public GitHub repository. Updated the README and friend guide with the concrete HTTPS clone URL, free setup preview/apply commands, restart/smoke-test instructions, fast-forward updates, and versioned ZIP/checksum download links for v0.1.0. The main README now uses the complete free preset rather than the older link-only installation path. No credentials, global provider policies, or plugin configuration outside the repository were changed for publication. Release packaging uses committed source; local logs, configs, dependencies, caches, and Git history are excluded from the ZIP.


## Full platform onboarding guide — v0.1.1

The user requested macOS, Linux, and Windows instructions plus OpenCode/OpenChamber downloads, sign-in, and connection steps. Added docs/GETTING_STARTED.md and linked it prominently from README and INSTALL. Verified upstream OpenChamber 2.4.0 release asset names and package requirements (Node >=24.14), published @opencode/cli 2.0.32 / @openchamber/web 2.4.0 versions, installed OpenCode auth login flags and device method, and official platform/server/sign-in documentation. The locally installed OpenChamber is 2.4.0 with bundled OpenCode 2.0.32. Desktop uses its bundled server; the CLI route pins the matching published versions.

Windows uses Ubuntu/WSL 2 with the CLI/browser interface, with an optional documented Windows Desktop pairing route to that WSL instance. Native Windows plugin installation is not claimed. Linux/WSL instructions are upstream-based and were not executed here. The guide keeps plugin/server/user environments aligned, separates UI passwords from provider sign-in, selects only the requested Free models, and explains external-server authentication and known availability limits. Bumped the distributable to 0.1.1 so the expanded guide ships in a new ZIP/release without replacing v0.1.0 assets. No runtime code, installed applications, credentials, or global configuration was changed.


Documentation validation: all 25 shell blocks across the README and installation/onboarding guides pass bash syntax checks; relative file/heading links resolve; package.json and both lockfile version fields agree at 0.1.1. Updated guide text passes the common secret-pattern check. These checks do not execute platform installers, sign in to any account, or establish Windows/Linux runtime support.

## Retry and adapter hardening — 2026-10-21

Expanded statusless provider-error classification to recognize endpoint/upstream-unavailable, gateway-timeout/bad-gateway tokens, and rate-limit message wording. Permanent HTTP statuses retain precedence. Retry-After parsing accepts surrounding whitespace; interrupted HTTP-200 bodies preserve header hints. Rate-limit/outage retries remain shared across repairs and bounded by the existing budgets and deadlines.

The OpenAI-compatible fallback now accepts top-level and nested `error.retry_after` hints in both HTTP-200 error envelopes and retryable HTTP error responses such as 429/503. Valid headers take precedence, including zero. Optional HTTP error-body reads are limited to 64 KiB and one second, respond to cancellation, and preserve the known HTTP classification if the body is malformed, oversized, interrupted, or stalled. Permanent HTTP errors skip inspection. Body contents remain absent from diagnostics and logs; failed requests do not enter history.

Progress callbacks now tolerate plain return values as well as Promises. Expanded regression coverage exercises native initialization/idle errors, interrupt diagnostics, argument/configuration guards, journals, concurrent execution, progress failures, UTF-8 chunk boundaries, and retry-hint precedence/backoff. TypeScript and all 228 tests pass, including nine tests for the HTTP error-body fix. The specification and historical reports now identify current behavior separately from earlier proposals/results. No new live inference or application restart was performed for these changes.

## Coding-debate fixes — 2026-10-21

Three live two-round coding debates completed through OpenChamber, with real role repair, timeout recovery, denied out-of-scope read, objection/revision cycles, minimum-round gating, concurrent execution, and a separate cancellation check. Testing also exposed a permanent guard error mislabeled as a retried provider outage, a false promise-timing claim accepted by both models, and caller-generated changes/omissions in returned transcripts. The [integration report](INTEGRATION.md) records the cases and their limits.

Native request classification now preserves local restricted-read guard diagnostics and rejects permanent SDK/request errors without provider backoff, while retaining retries for known transient HTTP/network failures. Prompts require independent mechanism and counterexample checks; all results carry `verification: "not_independently_verified"`, and convergence is labeled agreement rather than independent validation. These changes do not guarantee model accuracy or grant code-execution tools.

The registered tool returns an identical original Markdown attachment alongside text. Native Code Mode collects that file independently of the caller's generated prose; the final journal and tool metadata record its name, SHA-256, and UTF-8 bytes. A context hook replaces only matching original files with a text reference in model input so providers do not receive unsupported Markdown media; stored/UI attachments remain intact. Generated command and setup/usage/specification docs describe the exact-result channel and verification limits.

Validation: `npm run check` passes TypeScript and all 239 tests. New coverage exercises the actual AGENTS guard refusal, permanent SDK/malformed/programming errors, transient HTTP/network retries, falsely confident convergence still unverified, exact Unicode/raw-transcript attachments on complete and incomplete results, provider-context filtering without changing stored files or unrelated content, and a final-journal failure retaining an incomplete result with a matching fingerprint. Early logging failures also retain the incomplete/unverified notice.

A new actual `/debate` run through OpenChamber exercised the revised prompts and exact-result delivery. It completed three rounds in 268.933 seconds, corrected the main promise-state claim, and ended `max_rounds` with one remaining explanation objection rather than falsely converging. The 31,285-byte Markdown attachment matched the journal's SHA-256, retained all six raw replies, and appeared as a clickable file in the expanded Script card. The caller finished normally without a media error; parent and children were idle and reported zero cost. This is evidence for the delivery/protocol fixes, not a guarantee of model correctness. See the [live regression details](INTEGRATION.md#live-fix-regression--2026-10-21).

## Five maximum-round debates and direct-core timer fix — 2026-10-21

Deployed the existing fixes through the installed links, passed all 239 pre-deployment tests, and committed/pushed `d72cbfd`. Then ran five new actual `/debate` prompts concurrently through OpenChamber with minimum/maximum eight rounds: async iterator cleanup, version ABA, nullable SQL anti-joins, shortest walks with zero cycles, and expression-parser precedence. All five completed P0/C1/…/P7/C8 and reported convergence, giving 80 validated replies over 86 adapter attempts. Four timeout retries and two role repairs recovered; exact original files of 57,447–168,754 bytes matched their journals. All callers/children finished idle at zero cost. See the [full logic-test report](LOGIC_STRESS.md) for independent checks, sessions, and limitations.

The iterator answer remained wrong despite eight-round agreement. A child-history audit also found 88 reads denied by the existing guard, including a 63-attempt turn loop bounded by the call timeout. No successful debater tool execution or complete recorded reasoning-block replay was found. The final ABA code and parser passed independent executable checks; the SQL repairs and graph algorithm matched separate reference checks, with a minor graph precision overstatement retained. These findings remain model-quality/runtime limitations; permissions were not relaxed or a new denial-count policy introduced.

The audit reproduced a separate direct-core timer overflow: 2,147,483,648 ms became a 1 ms Node timer and dispatched a callback before immediately expiring. Configuration already rejected it. After all live callers became idle, aligned core validation with the integer timer bounds and avoided arming invalid total timers. The regression failed before the fix and now passes, including the inclusive maximum. The reproduction now reports a protocol error, zero callbacks, and no warnings. TypeScript and all 240 tests pass. Documentation and the public test report accompany this follow-up deployment; raw prompts/reasoning/runtime evidence remain ignored and private.

## Ten-risk failure audit — 2026-10-22

Selected ten likely failures from live-test findings and implementation boundaries, then ran 16 new tests against unchanged baseline `89e322c`: six passed and ten failed. The failing regressions preceded all implementation fixes. Added three more compatibility/isolation checks; all 19 audit tests and all 259 repository tests now pass with TypeScript.

Fixed per-call forbidden-tool denial limits, final-JSON recovery after broken inline drafts, malformed Unicode handling and exact UTF-8 output, permanent-error classification, observer mutation/rejection isolation, failed-initial-journal cleanup, and project config inheritance through `..branch` directories. Forbidden calls now end the debate with a partial protocol error at the third denial; this does not expand tools or file access. Existing collision preservation, large valid Unicode delivery, cancellation races, and orchestration-field/point-ID validation held in the new cases.

The eight-round false-consensus regression intentionally still demonstrates an incorrect agreed answer carrying `not_independently_verified`. General answer accuracy remains unresolved. These tests use adversarial fixtures and a fake native SDK rather than new inference. Reloaded the installed plugin through OpenChamber's OpenCode proxy while sessions were idle; its registry reports active and the hidden debater agent remains registered. No inference was requested. The [full audit](FAILURE_AUDIT.md) records the ten cases, evidence, and limits.

## Independent checks and five live verification debates — 2026-10-22

Added an optional trusted command verifier selected only by local configuration. It checks each proposed answer before the Challenger review, records the exact answer hash and finite scope, relays evidence to both sides, and prevents failed/inconclusive checks from stopping through convergence or early stalemate. Checker commands run without a shell and receive proposed text as JSON data. Deadlines/cancellation kill the process; invalid output, nonzero exits, and output overflow fail closed. A fixed-source Node prediction checker executes trusted fixtures and never evaluates model-generated source. Whole-answer verification remains unverified.

Five initial regressions failed before implementation. The first live five-case batch exposed missing canonical prediction data and a Challenger that returned a string instead of null; those failures were retained. Four more regressions preceded role-specific feedback, literal-null templates, runtime observations for inconclusive predictions, and rejected-answer labels. Reran all five cases on `c291e57` through the installed `/debate` command with eight minimum/maximum rounds: all completed 16 valid replies, all final predictions passed, all attachments matched their journals, and every caller/child finished idle with zero cost. The iterator and coercion cases corrected earlier false predictions using execution evidence. See the [complete report](VERIFICATION_LIVE.md).

The one repaired reply in that final batch revealed a parser false positive after a malformed but closed Markdown example. Reproduced it before fixing prefix recovery, then validated the exact recorded reply and the full suite after all live sessions were idle. TypeScript and all 281 tests pass, including 22 new regressions. These are finite scoped tests; unrelated factual claims and explanation prose still require independent evidence.
