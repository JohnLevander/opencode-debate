# opencode-debate

An OpenCode **2.0.32** plugin for debates between GLM 5.3 Flash Free and DeepSeek V4.1 Flash Free, usable from OpenChamber. TypeScript assigns the roles, alternates criticism and revision, validates JSON, tracks points, retries calls, enforces deadlines, and decides when to stop. No model orchestrates the loop.

**Current status:** The free OpenCode backend has a tested, opt-in **restricted-read compatibility mode**. The installed tool completed the IEEE 754 case and three two-round coding debates through OpenChamber. The coding tests also exposed an incorrect promise-timing claim that both models accepted: agreement is not independent verification. Results now carry that distinction and an original Markdown attachment for the exact output/transcript. The automated checks pass. Strict no-tools mode remains the default and still encounters the reported `FreeTierError`. No paid inference has been performed; the selectable OpenAI-compatible fallback remains optional. See [compatibility setup](#free-only-compatibility-mode), the [integration report](docs/INTEGRATION.md), [phase reports](docs/PHASES.md), [API findings](docs/FINDINGS.md), and [specification](docs/SPEC.md).

The [five maximum-round logic tests](docs/LOGIC_STRESS.md) completed eight rounds each through OpenChamber. They recovered four timeouts and two role repairs, preserved exact transcripts, and exposed another wrong answer surviving model agreement plus a loop of denied read attempts. The later [ten-risk failure audit](docs/FAILURE_AUDIT.md) reproduced ten failing regression tests before fixing seven implementation areas, including that denial loop. An optional [independent checker](docs/VERIFICATION.md) now blocks agreement when a proposed answer fails executable checks. The [five-case live verification batch](docs/VERIFICATION_LIVE.md) completed eight rounds each with all final output predictions independently passing, including corrections to the iterator and coercion cases. TypeScript and all **288 tests pass**. These tests establish exercised behavior, not guaranteed answer accuracy.

## Install and uninstall

**Starting from scratch?** Follow the [macOS, Linux, and Windows/WSL walkthrough](docs/GETTING_STARTED.md) for installing Node, OpenCode, and OpenChamber, signing in, and connecting the interface to the right server.

Requires **OpenCode 2.0.32**, Node.js **24**, npm, and Bash. macOS is tested; native Windows installation is unverified. A separate Bun installation is unnecessary.

Clone this public repository into a permanent folder and preview the free setup:

```sh
mkdir -p ~/dev
git clone https://github.com/JohnLevander/opencode-debate.git ~/dev/opencode-debate
cd ~/dev/opencode-debate
npm ci --ignore-scripts --include=dev --cache .cache/npm
npm run check
npm run setup:free -- --preview
```

If that folder already exists, use the [update instructions](docs/INSTALL.md#update-and-uninstall). Review the printed paths and JSON, then approve the changes:

```sh
npm run setup:free -- --apply
```

The setup creates plugin/command links and merges a private `debate.config.json` selecting the two free models, low reasoning variants, and restricted-read compatibility. Other validated debate settings are preserved; unrelated link targets are refused. It makes no credential, provider-policy, or `opencode.json(c)` changes. It honors `XDG_CONFIG_HOME`. No API key is needed, and there is no automatic paid fallback.

Restart OpenCode through **OpenChamber → Settings → General → Restart OpenCode** after active work finishes, refresh OpenChamber, and start a chat with a model explicitly marked **Free**. The preset configures debate children; it does not restrict your whole OpenCode account to free providers. Keep this repository at its installed path.

**For friends:** [start-to-finish setup](docs/GETTING_STARTED.md) · [plugin installation guide](docs/INSTALL.md) · [release ZIP and checksum](https://github.com/JohnLevander/opencode-debate/releases/latest). The guide covers downloads without Git, permissions, smoke tests, updates, and troubleshooting.

To uninstall, preview with `bash scripts/install.sh --dry-run`, then run `bash scripts/install.sh --uninstall` and restart OpenCode. Only matching plugin/command links are removed; config, logs, dependencies, and child sessions are retained. The lower-level `scripts/install.sh --apply` creates links only; use `setup:free` for the complete free preset.

## Use

```text
/debate In IEEE 754 double precision, does 0.1 + 0.2 exactly equal 0.3? Explain.
```

You can also explicitly ask the current agent to “debate this” or “use debate.” The tool is pinned in OpenCode's Code Mode catalog so it can be discovered with search. The command expands into a request to call the tool immediately; the calling model performs that initial invocation. The tool description prohibits unsolicited calls. It is an instruction to the calling model, not a perfect deterministic classifier of natural-language consent. In default strict mode, child debaters cannot invoke any tools. The explicitly enabled compatibility mode permits only the native `read` tool for a plugin-owned empty file, as described below.

The tool takes `question` (trimmed, nonempty, at most 100,000 characters), optional `context` (at most 300,000 characters), `min_rounds` (1–8, default 1), `max_rounds` (1–8), `first` (`glm`, `deepseek`, or `random`), and `include_transcript` (default false). Random assignment uses Node/Bun crypto; explicit `first` chooses the Proposer. With the OpenCode backend, the two sessions retain separate histories, live under the calling session via `parentID`, and are titled `debate: <slug> | GLM/DeepSeek (proposer/challenger)`. The fallback instead keeps two separate conversations in memory; it creates no OpenCode child sessions. Read its full transcript in the JSON log or set `include_transcript: true`.

To guarantee time for both sides to respond, request a minimum explicitly:

```text
/debate Is this review correct? Use min_rounds=3 and max_rounds=6.
```

`min_rounds=3` guarantees at least three completed turns per side before agreement or stalemate can stop the debate: P0, C1, P1, C2, P2, C3. The opening proposal counts as the Proposer's first turn. It does not force disagreement. Errors, cancellation, and deadlines can still stop earlier. An explicit `max_rounds` must be at least the minimum (upper bound 8). When `max_rounds` is omitted, the configured default (4) is raised to the minimum, so `min_rounds=6` alone runs up to six rounds. These are tool arguments interpreted from the command's natural-language request, not shell flags.

Normal completion always ends on the Challenger's review, once the requested minimum is met. `converged` means the Challenger endorses the latest answer and no points remain open. `stalemate` means consecutive Challenger turns have identical open-ID sets, starting at C2. `max_rounds` means the review budget was exhausted. The result starts with the latest valid Proposer answer (labeled partial on error/cancellation and current on non-convergence), then unresolved points with both positions, the reason, log path, and child-session IDs. Model-written text (the answer, point summaries and notes, and transcript replies) appears verbatim inside fenced `text` blocks whose fence is longer than any backtick run in that text, so a reply cannot close its block or forge result headings, labels, or independent-check sections. If the final log checkpoint fails twice, the completed result is still returned with a `Log warning` section instead of being replaced by an error. An incomplete result additionally states how many Challenger reviews were validated and where the run stopped (error code, turn, attempt count, and rejected replies across the run), so it cannot be mistaken for a completed review; transcript turns that never validated are labeled unvalidated. Errors and cancellation preserve collected work. An empty validated point list on an incomplete debate does not establish agreement. An error before any valid proposal reports that no answer was gathered. OpenChamber's Stop action also aborts the parent step, so the UI shows “Step interrupted” instead of the returned cancellation Markdown; read the JSON log for the partial result.

A converged answer is labeled **Agreed answer (not independently verified)**. Every engine result has `verification: "not_independently_verified"`; confidence and agreement never upgrade it. The debaters cannot execute code or independently inspect facts. Prompts ask them to reconstruct disputed mechanisms, test counterexamples, distinguish observed execution from predictions, and retain uncertainty when evidence is insufficient.

For claims with executable ground truth, configure an [independent verifier](docs/VERIFICATION.md). It runs outside the debaters after each proposal, supplies evidence to both sides, and blocks convergence/stalemate until the current answer passes. The result records the exact answer hash, check count, scope, and evidence; a scoped pass does not prove the entire explanation. The included Node prediction checker executes a fixed trusted fixture and compares the answer's predicted JSON output, without executing model-generated source. No checker is enabled by default.

The registered tool returns both text and an identical `debate-result-<hash>.md` attachment, including the full raw turn replies when `include_transcript` is true. OpenCode Code Mode collects the attachment separately from the caller's returned text. Use that file or the private JSON journal as the authoritative result: the calling model can still reformat or omit details in its chat reply. The attachment's name, full SHA-256, and UTF-8 byte count are recorded as `originalResult` in tool metadata and the final journal. A context hook replaces only matching original attachments with a text reference for subsequent model requests, keeping unsupported Markdown media out of provider input while preserving the stored/UI file.

Malformed Unicode in an answer or point triggers the bounded reply-repair path. Lone UTF-16 surrogates in rejected raw text are shown as visible `\uXXXX` escapes in Markdown; the JSON journal retains their original code units. This avoids silent UTF-8 replacement and keeps the canonical Markdown, attachment, hash, and byte count consistent. Valid Unicode is unchanged.

The result also includes a **Contribution winner (text-reuse estimate)** line and both models' credited word counts. Deterministic code assigns words in retained five-word phrases to the model that introduced those phrases first in a valid answer or point. Case and punctuation are normalized; a phrase must contain at least three words outside a small English stop-word list. Matching supplied question/context is excluded. Ties are explicit; short/unmatched answers and incomplete errors/cancellations have no declared winner. The log records the method and all counts.

This measures retained wording. It can miss paraphrased ideas, and a largely retained opening answer will favor the Proposer. It does not judge correctness or change convergence, stalemate, or model behavior. Unresolved disagreements remain unresolved regardless of the contribution score.

## Configuration

Use JSON in `~/.config/opencode/debate.config.json` for defaults, or `<project>/.opencode/debate.config.json` for project settings. Within a known project, ancestor `.opencode` directories are read from project root to the active directory. More specific files override global settings; environment variables override files. Settings that decide where credentials and transcripts go or which local program runs — `verifier`, `logDir`, `openaiCompatible.baseURL`, and `openaiCompatible.apiKeyEnv` — are accepted only from the global file or the server environment. A project file that sets any of them fails with a configuration error, so a cloned repository cannot redirect your API key, write logs into its tree, or run a command. Objects merge recursively. Unknown fields and invalid values fail clearly and produce an error log using the default log location when the config itself cannot be loaded.

Start from `debate.config.example.json`. Copying a configuration outside the repository requires approval first.

| Field | Default |
| --- | --- |
| `backend` | `opencode` |
| `readCompatibility` | `false`; opt-in single-empty-file native read for the OpenCode backend |
| `models.glm` | `{ "providerID": "opencode", "modelID": "glm-5.3-flash-free" }` |
| `models.deepseek` | `{ "providerID": "opencode", "modelID": "deepseek-v4.1-flash-free" }` |
| `models.<debater>.variant` | OpenCode backend only; omitted; installed inventory supports `low`, `high`, `max` |
| `defaultMaxRounds` | 4 |
| `callTimeoutMs` | 300000 (5 minutes) |
| `totalTimeoutMs` | 1800000 (30 minutes) |
| `logDir` | `~/.local/share/opencode-debate/debates` (`XDG_DATA_HOME` is honored); global file or environment only |
| `verifier` | omitted; optional trusted `command` array (absolute executable), `scope`, and `timeoutMs` (default 10000); global file only; see [checker contract](docs/VERIFICATION.md) |
| `openaiCompatible.baseURL` | `https://openrouter.ai/api/v1` (API base; `/chat/completions` is appended); global file or environment only |
| `openaiCompatible.apiKeyEnv` | `OPENROUTER_API_KEY` (environment variable name, never the key itself); global file or environment only |
| `openaiCompatible.models.glm` | `z-ai/glm-5.3-flash` |
| `openaiCompatible.models.deepseek` | `deepseek/deepseek-v4.1-flash` |

Environment overrides: `OPENCODE_DEBATE_BACKEND`, `OPENCODE_DEBATE_LOG_DIR`, `OPENCODE_DEBATE_MAX_ROUNDS`, `OPENCODE_DEBATE_CALL_TIMEOUT_MS`, `OPENCODE_DEBATE_TOTAL_TIMEOUT_MS`, and `OPENCODE_DEBATE_GLM_PROVIDER_ID`, `OPENCODE_DEBATE_GLM_MODEL_ID`, `OPENCODE_DEBATE_GLM_VARIANT` (equivalent `DEEPSEEK` fields are supported). `OPENCODE_DEBATE_READ_COMPATIBILITY` accepts exactly `true` or `false`. `OPENCODE_DEBATE_BASE_URL` sets the fallback endpoint. Fallback-only overrides are `OPENCODE_DEBATE_FALLBACK_API_KEY_ENV`, `OPENCODE_DEBATE_FALLBACK_GLM_MODEL_ID`, and `OPENCODE_DEBATE_FALLBACK_DEEPSEEK_MODEL_ID`; the existing `GLM/DEEPSEEK_MODEL_ID` fields affect only the OpenCode backend. Set these in the environment of the **OpenCode server**, then restart it; exporting them in an unrelated terminal does not change a running server.

## Free-only compatibility mode

The strict no-tools agent triggers a misleading free-tier rejection on this installation. The user approved a narrowly scoped compatibility experiment. It succeeded with both configured free models, without an API key, paid provider, shell access, or user-file access. Free-provider capacity errors can still occur; bounded rate-limit retries remain in effect.

To opt in, merge this into your chosen `debate.config.json`; approve the exact change before editing a global file:

```json
{
  "backend": "opencode",
  "readCompatibility": true
}
```

Restart the hosting OpenCode process to load the updated plugin. The acceptance tests used the `low` reasoning variant for each model; set `models.glm.variant` and `models.deepseek.variant` to `low` to reproduce that choice. Their model IDs and zero-cost provider stay unchanged.

This mode preserves the **genuine built-in `read` definition and implementation** and removes every other debater tool. Session permission rules allow reading only `assets/compatibility/empty.txt` in the plugin repository. For a file outside the active project, OpenCode also requires authorization for that file's containing directory; the read rules and execution guard still reject every other file and directory. The plugin adds no dummy tool, custom provider, or provider-header substitution.

A second execution guard rejects non-read tools and paths other than that exact file, verifies that it remains an empty regular file with no symlink substitution, and refuses nearby `AGENTS.md` files that native read could otherwise load as extra instructions. A failed compatibility check stops immediately with its local diagnostic, without provider backoff or child creation. The permission grant is removed from the plugin's runtime registry when the debate finishes; later prompts in retained debater sessions have all tools removed. Models are instructed to reason without calling tools. The successful IEEE trial made no debater tool calls. Later coding debates completed two rounds, including objections and revisions; one attempted `/dev/null` read was rejected. Free-model role/schema adherence and answer accuracy remain limitations.

During a native call, the **third denied tool attempt** interrupts that child with a `tool_violation` error. The engine re-asks that turn once, prefixed with an instruction not to call tools. A second interrupt in the same logical turn ends the debate with `tool_violation` and the collected partial result. (A live subjective debate had resolved four points when one stray loop of directory reads ended it; this repair keeps that progress.) The counter resets for each native call and is isolated between participants and debates. It does not expand file access or retry the forbidden call. Repeated allowed reads of the empty file remain bounded by the ordinary deadlines.

This is an explicit exception to the original all-tools-disabled requirement. It is disabled by default and applies only to the OpenCode backend. Set `readCompatibility` to `false` to restore strict isolation. Keep the empty asset unchanged; validation failures stop the debate rather than expanding access. See the integration report for the exact test evidence and remaining limitations.

## Switching to the fallback

Merge this into the global `debate.config.json` above, after approving the change. A project `.opencode/` file may set `backend` and `openaiCompatible.models`, but not `baseURL` or `apiKeyEnv`:

```json
{
  "backend": "openai-compatible",
  "openaiCompatible": {
    "baseURL": "https://openrouter.ai/api/v1",
    "apiKeyEnv": "OPENROUTER_API_KEY",
    "models": {
      "glm": "z-ai/glm-5.3-flash",
      "deepseek": "deepseek/deepseek-v4.1-flash"
    }
  }
}
```

Provide `OPENROUTER_API_KEY` through the environment of the process that starts the OpenCode server, then restart OpenCode/OpenChamber. A terminal export only applies when that terminal launches the server; it does not update an already running desktop app. For another compatible provider, change the API base URL, model IDs, and environment-variable name. Base URLs must be HTTP(S) without embedded credentials, query parameters, or fragments. The adapter appends `/chat/completions`; do not supply the full completion endpoint. Missing keys produce a logged error before any HTTP request.

For OpenChamber desktop, add the key in **Settings → General → Environment variables** as `OPENROUTER_API_KEY`, then restart OpenCode. Alternatively, quit OpenChamber and run this helper in your own terminal:

```sh
python3 ~/dev/opencode-debate/scripts/set-openrouter-key.py
```

The helper previews the target change, asks for the key with hidden input, and merges it into OpenChamber's `environment.json` with mode `0600`, preserving other variables and project settings. It honors `OPENCHAMBER_DATA_DIR`. It never accepts the key as a command argument or prints it. Reopen OpenChamber afterward so its managed OpenCode server inherits the saved variable.

Run `/debate ...` normally after configuration. Selecting this backend sends the question/context and each debater's conversation directly to the configured endpoint and can incur provider charges. There is no automatic paid fallback: an OpenCode model failure never switches backend. Set `backend` back to `opencode` to return to the free-session transport. No credentials are placed in JSON or logged by the adapter.

The fallback sends non-streaming text chat requests with the same system prompt from `src/prompts.ts`, without tool definitions. It retains each model's completed text turns in memory and lets the core own retries, parsing, convergence, and deadlines. Failed requests are not appended to history; valid HTTP replies with malformed debate JSON are retained for the one repair turn. Final text is separate from `reasoning`/`reasoning_content`; when only `reasoning_details` is available, that array is serialized into the reasoning log field. Reasoning is never replayed or relayed. No OpenCode reasoning variant is translated into an endpoint-specific parameter.

Cancellation/deadlines abort active fetches and discard late replies. Disconnecting cannot guarantee that a remote provider stops computing or billing. The mock tests establish local transport behavior, not production model quality, availability, or provider billing behavior. Endpoints that require reasoning blocks replayed into history, streaming-only responses, tool calls, or non-text content are unsupported. Truncated/refused/tool-call responses fail clearly. HTTP 429, transient HTTP 408/500/502/503/504 failures, Anthropic-style 529 overloads, Cloudflare origin failures 520-524, compatible service-error envelopes (including overload wording such as `overloaded_error`, "the API is temporarily overloaded", endpoint/upstream-unavailable, gateway-timeout, and bad-gateway tokens), fallback network failures, and interrupted HTTP-200 bodies (a connection that drops mid-body) feed bounded engine backoff with `Retry-After`. Authentication, configuration, and other permanent HTTP failures stop immediately, as do authentication-style envelope types such as `invalid_api_key`; outage or rate-limit wording in a body or error envelope never makes a permanent status such as 400 or 404 retryable, and non-listed 5xx statuses (e.g. 501) remain permanent. Where wording is authoritative — statusless error envelopes and HTTP 429 — any unavailable/overloaded phrasing classifies as an outage without requiring specific provider vocabulary. Native gateway messages such as `provider.rate-limit: Endpoint is unavailable` are classified as provider outages rather than quota errors, even when the gateway attaches HTTP 429. Provider error bodies are omitted from logs/results to avoid echoing secrets, and releasing an error body never masks or delays its status classification. A redirecting fallback endpoint is a permanent configuration error (set `baseURL` to the final URL), as are oversized responses (rejected past 16 MiB rather than buffered) and API keys containing control characters. Transient OpenCode-server failures during native child creation or prompting classify as provider outages and feed the same bounded retries; a partially created adapter recovers by creating only the missing children, never duplicates. `Retry-After` parsing accepts only plain decimal seconds or HTTP-dates per RFC 9110.


## Protocol and retry guarantees

Only the Challenger can introduce objection IDs. When the requested deliverable is itself JSON (even an object with the reply's own keys), the prompts direct the Proposer to place it, escaped, inside the `answer` string; it never replaces the debate reply. The Challenger is told to treat an answer that omits a requested deliverable as a flaw. This is prompt guidance: the engine cannot tell a deliverable from a reply that happens to share its shape. The opening Proposer must return `points: []`; revisions can address only canonical IDs with `conceded` or `defended`. The Challenger must return `answer: null`, introduce consecutive IDs with `open` status, and cannot claim agreement while any canonical point remains open. Review finding numbers and IDs mentioned in prose never create objections. Initial, revision, and repair prompts all carry the authoritative canonical point state; Challenger-facing prompts state the next unused ID, while Proposer-facing prompts never advertise one and bar creating IDs. A rejected reply cannot mutate point state or consume IDs. The Challenger may explicitly reopen a resolved or withdrawn point by returning it with status open (for example, when a later revision regresses); reopening is a deliberate decision, never implicit.

Each logical turn has at most two provider retries shared across rate limits and outages, one timeout retry, one forbidden-tool repair, one JSON/protocol repair, and one missing-point repair. Repairing a response does not reset transport budgets. Backoff starts at one second and doubles, honors valid `Retry-After` hints (HTTP header or a body-carried `retry_after`; the header wins), and is bounded by cancellation and the total deadline. This permits at most seven dispatched attempts per turn; it never changes the selected model or backend automatically. A persistent outage still ends with an explicitly incomplete result.

Native SDK request failures use the same HTTP classification when a status is available. Declared request errors (such as unauthorized, missing-session, or invalid-request errors), malformed SDK replies, local compatibility checks, and unexpected programming errors are permanent. Only recognized SDK/network transport failures become statusless retryable outages; remote error bodies are not echoed in request diagnostics.

For retryable HTTP errors without a valid `Retry-After` header, the fallback reads top-level or nested `error.retry_after` hints from the JSON body, with a 64 KiB limit and a one-second read budget. Malformed, oversized, interrupted, or stalled error bodies preserve the HTTP status classification and use the default backoff. Permanent HTTP errors skip body inspection.

Progress updates tolerate throwing, rejecting, stalled, and non-Promise host callbacks. Pending updates have a one-second wait budget so they cannot hold the completed debate indefinitely.

Core `onEvent` and `onTurn` observers receive independent copies; mutation cannot change engine state. Synchronous throws and rejected Promises are isolated, and the engine never waits for an observer's Promise.

Debaters receive an explicit evidence rule: paths, line numbers, and supplied review claims do not establish that they inspected source. Without source excerpts they must state conditional reasoning and uncertainty. This is a prompt constraint, not independent source verification; agreement between two models remains insufficient to validate a code review.

## Logs and prompt tuning

`limits` records the resolved minimum/maximum. Each accepted Challenger review adds a `stopChecks` entry with its open IDs, previous IDs, agreement flag, whether the minimum was met, and the stop/continue decision. `validationFailures` records each rejected reply, timestamp, turn, and whether its bounded repair was requested. Raw attempts remain in the turn log, with an `errorCode` for each rejected or failed attempt; a schema-valid reply that the role rules reject keeps its parsed JSON on that attempt for diagnosis. `retryEvents` records retry reasons, timestamps, and scheduled delays. On failure, `failure` records the error code, turn, debater, attempt count for that turn, and rejected-reply count across the run. Incomplete results state how many Challenger reviews were validated and mark rejected transcript replies as unvalidated. The contribution method, counts, and winner are logged too.

Every run checkpoints a JSON file named `<ISO timestamp>-<question-slug>-<run-suffix>.json` in `logDir`. It includes question/context, resolved configuration and role assignment, all attempts and turns (raw final text, parsed JSON, separate reasoning when available, timestamps, retry count/reasons), point history, status/reason, verification status, final Markdown and its `originalResult` fingerprint, retained child-session details, and interrupt requests/acknowledgments. An interrupt acknowledgment of `false` means that request found no active execution to interrupt; an unstarted Challenger is normally idle. Logs are created with mode `0600`; newly created log directories use `0700`. No API key or authentication-header configuration is logged.

Logs intentionally contain the full question, context, model text, and available reasoning. Opponents receive only the validated reply JSON, including the full answer and point notes, alongside canonical point state; free-form prose and rejected attempts are not relayed. Reasoning is never relayed. Logs are not committed, and there is no automatic retention/deletion policy.

Tune all model/agent instructions and repair prompts in `src/prompts.ts`. The command template also lives there; after changing it, run `npm run generate-command` to update the linked Markdown file. Logic lives in `src/core/`; the v2 transport is `src/adapters/opencode.ts`, and the fallback transport is `src/adapters/openai-compatible.ts`.

## Limits and diagnostics

The free models are limited-time offers and require OpenCode. In this installation, using OpenCode is insufficient when all debater tools are disabled: the gateway returns `provider.auth` / `FreeTierError` before producing a proposal. Default strict mode retains deny-all permissions and removes all tool declarations. The opt-in restricted-read mode described above worked in the tested installation. There is no automatic paid substitution. Free GLM can be slow. OpenCode model availability is checked before creating children; missing models fail with a configuration pointer. Two models agreeing does not establish correctness. The open-ID stalemate rule can stop a debate even when their arguments have become more detailed. Debaters have no browsing or independent fact verification; compatibility read exposes only an empty file. Treat relayed context as debate material rather than trusted instructions.

The v2.0.32 Promise plugin adapter ignores request-option abort signals. This plugin races its own signals, explicitly interrupts children, and prevents a late-admitted prompt from overlapping a retry. Child sessions are retained on error/cancellation for inspection. If the server itself is unreachable, interrupt acknowledgment can fail; the log records that diagnostic. A process kill, machine failure, or unwritable disk cannot guarantee a final cancellation log.

V2 uses `session.prompt({ sessionID, text })`, then wait/context reads; it does not return an answer from prompt admission. Some wait endpoints are experimental. The implementation targets the pinned release and needs testing before upgrades. See `docs/FINDINGS.md` for source-level evidence and known historical hanging-prompt issues.

Development checks: `npm run check` runs typechecking and the scripted core, mocked v2 transport, local HTTP fallback integration, plugin registration, output-attachment fidelity, configuration, and private-log tests. `npm run install:preview` performs no installation. The [integration report](docs/INTEGRATION.md) distinguishes actual provider failures from passing tests with an injected pre-dispatch delay. In OpenChamber, inspect children through the calling session's **Subagents** panel; that parent-child relationship was verified. No deadlock occurred in the exercised failure, timeout, or cancellation paths. Successful free-model agreement was observed for the IEEE and coding cases with compatibility mode; strict no-tools execution remains blocked.
