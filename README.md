# opencode-debate

An OpenCode **2.0.32** plugin for debates between GLM 5.3 Flash Free and DeepSeek V4.1 Flash Free, usable from OpenChamber. TypeScript assigns the roles, alternates criticism and revision, validates JSON, tracks points, retries calls, enforces deadlines, and decides when to stop. No model orchestrates the loop.

**Current status:** All four implementation phases are committed separately. The OpenAI-compatible fallback is implemented and tested against a local mock server; no paid inference has been performed. The 59 automated tests pass. OpenChamber child-session display, timeout handling, and UI cancellation were verified with the OpenCode backend. **Free-model debates remain blocked** by `FreeTierError` from the required tool-free agent inside OpenCode, matching [upstream issue #51241](https://github.com/anomalyco/opencode/issues/51241). Real-model agreement is still unverified. The default backend remains `opencode`; select the fallback explicitly as described below. See the [integration report](docs/INTEGRATION.md), [phase reports](docs/PHASES.md), [API findings](docs/FINDINGS.md), and [specification](docs/SPEC.md).

## Install and uninstall

Requires Node.js 24 for development/tests and OpenCode 2.0.32 with its embedded Bun runtime. A separate Bun installation is unnecessary.

```sh
cd ~/dev/opencode-debate
npm ci --ignore-scripts --cache .cache/npm
npm run check
npm run install:preview
```

Review the preview and approve its global changes before running:

```sh
bash scripts/install.sh --apply
```

The installer creates two links:

- `~/.config/opencode/plugins/opencode-debate` → this repository
- `~/.config/opencode/commands/debate.md` → this repository's `commands/debate.md`

It honors `XDG_CONFIG_HOME`, refuses to overwrite unrelated entries, and makes no `opencode.json(c)` changes. The plugin defines its hidden agent itself. Restart OpenCode/OpenChamber after installation; links keep subsequent repository changes connected to the installation. Stop running debates before restarting.

To remove only those links, preview their paths and approve the removal first, then run `bash scripts/install.sh --uninstall` and restart. Existing logs and child sessions are retained. The installer does not delete them or modify your existing free-only plugin or provider policies.

## Use

```text
/debate In IEEE 754 double precision, does 0.1 + 0.2 exactly equal 0.3? Explain.
```

You can also explicitly ask the current agent to “debate this” or “use debate.” The command expands into a request to call the tool; the calling model performs that initial invocation. The tool description prohibits unsolicited calls. It is an instruction to the calling model, not a perfect deterministic classifier of natural-language consent. Child debaters cannot invoke any tools.

The tool takes `question`, optional `context`, `max_rounds` (1–8), `first` (`glm`, `deepseek`, or `random`), and `include_transcript` (default false). Random assignment uses Node/Bun crypto; explicit `first` chooses the Proposer. With the OpenCode backend, the two sessions retain separate histories, live under the calling session via `parentID`, and are titled `debate: <slug> | GLM/DeepSeek (proposer/challenger)`. The fallback instead keeps two separate conversations in memory; it creates no OpenCode child sessions. Read its full transcript in the JSON log or set `include_transcript: true`.

Normal completion always ends on the Challenger's review. `converged` means the Challenger endorses the latest answer and no points remain open. `stalemate` means consecutive Challenger turns have identical open-ID sets, starting at C2. `max_rounds` means the review budget was exhausted. The result starts with the latest valid Proposer answer, then unresolved points with both positions, the reason, log path, and child-session IDs. Errors and cancellation preserve collected work. An error before any valid proposal reports that no answer was gathered. OpenChamber's Stop action also aborts the parent step, so the UI shows “Step interrupted” instead of the returned cancellation Markdown; read the JSON log for the partial result.

## Configuration

Use JSON in `~/.config/opencode/debate.config.json` for defaults, or `<project>/.opencode/debate.config.json` for project settings. Within a known project, ancestor `.opencode` directories are read from project root to the active directory. More specific files override global settings; environment variables override files. Objects merge recursively. Unknown fields and invalid values fail clearly and produce an error log using the default log location when the config itself cannot be loaded.

Start from `debate.config.example.json`. Copying a configuration outside the repository requires approval first.

| Field | Default |
| --- | --- |
| `backend` | `opencode` |
| `models.glm` | `{ "providerID": "opencode", "modelID": "glm-5.3-flash-free" }` |
| `models.deepseek` | `{ "providerID": "opencode", "modelID": "deepseek-v4.1-flash-free" }` |
| `models.<debater>.variant` | OpenCode backend only; omitted; installed inventory supports `low`, `high`, `max` |
| `defaultMaxRounds` | 4 |
| `callTimeoutMs` | 300000 (5 minutes) |
| `totalTimeoutMs` | 1800000 (30 minutes) |
| `logDir` | `~/.local/share/opencode-debate/debates` (`XDG_DATA_HOME` is honored) |
| `openaiCompatible.baseURL` | `https://openrouter.ai/api/v1` (API base; `/chat/completions` is appended) |
| `openaiCompatible.apiKeyEnv` | `OPENROUTER_API_KEY` (environment variable name, never the key itself) |
| `openaiCompatible.models.glm` | `z-ai/glm-5.3-flash` |
| `openaiCompatible.models.deepseek` | `deepseek/deepseek-v4.1-flash` |

Environment overrides: `OPENCODE_DEBATE_BACKEND`, `OPENCODE_DEBATE_LOG_DIR`, `OPENCODE_DEBATE_MAX_ROUNDS`, `OPENCODE_DEBATE_CALL_TIMEOUT_MS`, `OPENCODE_DEBATE_TOTAL_TIMEOUT_MS`, and `OPENCODE_DEBATE_GLM_PROVIDER_ID`, `OPENCODE_DEBATE_GLM_MODEL_ID`, `OPENCODE_DEBATE_GLM_VARIANT` (equivalent `DEEPSEEK` fields are supported). `OPENCODE_DEBATE_BASE_URL` sets the fallback endpoint. Fallback-only overrides are `OPENCODE_DEBATE_FALLBACK_API_KEY_ENV`, `OPENCODE_DEBATE_FALLBACK_GLM_MODEL_ID`, and `OPENCODE_DEBATE_FALLBACK_DEEPSEEK_MODEL_ID`; the existing `GLM/DEEPSEEK_MODEL_ID` fields affect only the OpenCode backend. Set these in the environment of the **OpenCode server**, then restart it; exporting them in an unrelated terminal does not change a running server.

## Switching to the fallback

Merge this into your chosen `debate.config.json` (project `.opencode/` or global location above), after approving any change outside the repository:

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

Cancellation/deadlines abort active fetches and discard late replies. Disconnecting cannot guarantee that a remote provider stops computing or billing. The mock tests establish local transport behavior, not production model quality, availability, or provider billing behavior. Endpoints that require reasoning blocks replayed into history, streaming-only responses, tool calls, or non-text content are unsupported. Truncated/refused/tool-call responses fail clearly. HTTP 429 and equivalent error envelopes feed bounded engine backoff with `Retry-After`; other HTTP failures stop immediately. Provider error bodies are omitted from logs/results to avoid echoing secrets.


## Logs and prompt tuning

Every run checkpoints a JSON file named `<ISO timestamp>-<question-slug>-<run-suffix>.json` in `logDir`. It includes question/context, resolved configuration and role assignment, all attempts and turns (raw final text, parsed JSON, separate reasoning when available, timestamps, retry count/reasons), point history, status/reason, final Markdown, retained child-session details, and interrupt requests/acknowledgments. An interrupt acknowledgment of `false` means that request found no active execution to interrupt; an unstarted Challenger is normally idle. Logs are created with mode `0600`; newly created log directories use `0700`. No API key or authentication-header configuration is logged.

Logs intentionally contain the full question, context, model text, and available reasoning. Opponents receive only final text parts; reasoning is never relayed. Logs are not committed, and there is no automatic retention/deletion policy.

Tune all model/agent instructions and repair prompts in `src/prompts.ts`. The command template also lives there; after changing it, run `npm run generate-command` to update the linked Markdown file. Logic lives in `src/core/`; the v2 transport is `src/adapters/opencode.ts`, and the fallback transport is `src/adapters/openai-compatible.ts`.

## Limits and diagnostics

The free models are limited-time offers and require OpenCode. In this installation, using OpenCode is insufficient when all debater tools are disabled: the gateway returns `provider.auth` / `FreeTierError` before producing a proposal. The plugin retains the specified deny-all permissions and removes all tool declarations. There is no permission workaround or automatic paid substitution. Use an upstream fix when available or explicitly select the implemented fallback to run these debates. Free GLM can be slow. OpenCode model availability is checked before creating children; missing models fail with a configuration pointer. Two models agreeing does not establish correctness. The open-ID stalemate rule can stop a debate even when their arguments have become more detailed. Debaters have no tools, browsing, or independent fact verification. Treat relayed context as debate material rather than trusted instructions.

The v2.0.32 Promise plugin adapter ignores request-option abort signals. This plugin races its own signals, explicitly interrupts children, and prevents a late-admitted prompt from overlapping a retry. Child sessions are retained on error/cancellation for inspection. If the server itself is unreachable, interrupt acknowledgment can fail; the log records that diagnostic. A process kill, machine failure, or unwritable disk cannot guarantee a final cancellation log.

V2 uses `session.prompt({ sessionID, text })`, then wait/context reads; it does not return an answer from prompt admission. Some wait endpoints are experimental. The implementation targets the pinned release and needs testing before upgrades. See `docs/FINDINGS.md` for source-level evidence and known historical hanging-prompt issues.

Development checks: `npm run check` runs typechecking and the scripted core, mocked v2 transport, local HTTP fallback integration, plugin registration, configuration, and private-log tests. `npm run install:preview` performs no installation. The [integration report](docs/INTEGRATION.md) distinguishes actual provider failures from passing tests with an injected pre-dispatch delay. In OpenChamber, inspect children through the calling session's **Subagents** panel; that parent-child relationship was verified. No deadlock occurred in the exercised failure, timeout, or cancellation paths; successful multi-round provider execution remains unverified.
