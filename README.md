# opencode-debate

An OpenCode **2.0.32** plugin for debates between GLM 5.3 Flash Free and DeepSeek V4.1 Flash Free, usable from OpenChamber. TypeScript assigns the roles, alternates criticism and revision, validates JSON, tracks points, retries calls, enforces deadlines, and decides when to stop. No model orchestrates the loop.

**Current status:** Installed and tested through Phase 3 on OpenCode 2.0.32. The 40 automated tests pass; OpenChamber child-session display, timeout handling, and UI cancellation are verified. **Real debates are currently blocked:** free-model requests from the required tool-free agent receive `FreeTierError` inside OpenCode. This matches [upstream issue #51241](https://github.com/anomalyco/opencode/issues/51241). Neither real-model convergence nor a contested debate was achieved. See the [integration report](docs/INTEGRATION.md), [phase reports](docs/PHASES.md), [API findings](docs/FINDINGS.md), and [specification](docs/SPEC.md). Phase 4's paid fallback remains unimplemented, awaiting approval.

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

The tool takes `question`, optional `context`, `max_rounds` (1–8), `first` (`glm`, `deepseek`, or `random`), and `include_transcript` (default false). Random assignment uses Node/Bun crypto; explicit `first` chooses the Proposer. The two sessions retain separate histories, live under the calling session via `parentID`, and are titled `debate: <slug> | GLM/DeepSeek (proposer/challenger)`.

Normal completion always ends on the Challenger's review. `converged` means the Challenger endorses the latest answer and no points remain open. `stalemate` means consecutive Challenger turns have identical open-ID sets, starting at C2. `max_rounds` means the review budget was exhausted. The result starts with the latest valid Proposer answer, then unresolved points with both positions, the reason, log path, and child-session IDs. Errors and cancellation preserve collected work. An error before any valid proposal reports that no answer was gathered. OpenChamber's Stop action also aborts the parent step, so the UI shows “Step interrupted” instead of the returned cancellation Markdown; read the JSON log for the partial result.

## Configuration

Use JSON in `~/.config/opencode/debate.config.json` for defaults, or `<project>/.opencode/debate.config.json` for project settings. Within a known project, ancestor `.opencode` directories are read from project root to the active directory. More specific files override global settings; environment variables override files. Objects merge recursively. Unknown fields and invalid values fail clearly and produce an error log using the default log location when the config itself cannot be loaded.

Start from `debate.config.example.json`. Copying a configuration outside the repository requires approval first.

| Field | Default |
| --- | --- |
| `backend` | `opencode` |
| `models.glm` | `{ "providerID": "opencode", "modelID": "glm-5.3-flash-free" }` |
| `models.deepseek` | `{ "providerID": "opencode", "modelID": "deepseek-v4.1-flash-free" }` |
| `models.<debater>.variant` | Omitted; the installed inventory supports `low`, `high`, `max` |
| `defaultMaxRounds` | 4 |
| `callTimeoutMs` | 300000 (5 minutes) |
| `totalTimeoutMs` | 1800000 (30 minutes) |
| `logDir` | `~/.local/share/opencode-debate/debates` (`XDG_DATA_HOME` is honored) |
| `openaiCompatible` | Reserved Phase 4 settings shown in the example |

Environment overrides: `OPENCODE_DEBATE_BACKEND`, `OPENCODE_DEBATE_LOG_DIR`, `OPENCODE_DEBATE_MAX_ROUNDS`, `OPENCODE_DEBATE_CALL_TIMEOUT_MS`, `OPENCODE_DEBATE_TOTAL_TIMEOUT_MS`, and `OPENCODE_DEBATE_GLM_PROVIDER_ID`, `OPENCODE_DEBATE_GLM_MODEL_ID`, `OPENCODE_DEBATE_GLM_VARIANT` (equivalent `DEEPSEEK` fields are supported). `OPENCODE_DEBATE_BASE_URL` sets the reserved fallback endpoint. Set these in the environment of the **OpenCode server**, then restart it; exporting them in an unrelated terminal does not change a running server.

The fallback configuration will use `backend: "openai-compatible"`, default endpoint `https://openrouter.ai/api/v1`, models `z-ai/glm-5.3-flash` and `deepseek/deepseek-v4.1-flash`, and `OPENROUTER_API_KEY`. Until Phase 4 is implemented, selecting it returns a clear logged error. There is no automatic paid fallback. Do not put an API key in JSON or commit it.

## Logs and prompt tuning

Every run checkpoints a JSON file named `<ISO timestamp>-<question-slug>-<run-suffix>.json` in `logDir`. It includes question/context, resolved configuration and role assignment, all attempts and turns (raw final text, parsed JSON, separate reasoning when available, timestamps, retry count/reasons), point history, status/reason, final Markdown, retained child-session details, and interrupt requests/acknowledgments. An interrupt acknowledgment of `false` means that request found no active execution to interrupt; an unstarted Challenger is normally idle. Logs are created with mode `0600`; newly created log directories use `0700`. No API key or authentication-header configuration is logged.

Logs intentionally contain the full question, context, model text, and available reasoning. Opponents receive only final text parts; reasoning is never relayed. Logs are not committed, and there is no automatic retention/deletion policy.

Tune all model/agent instructions and repair prompts in `src/prompts.ts`. The command template also lives there; after changing it, run `npm run generate-command` to update the linked Markdown file. Logic lives in `src/core/`; the v2 transport is `src/adapters/opencode.ts`.

## Limits and diagnostics

The free models are limited-time offers and require OpenCode. In this installation, using OpenCode is insufficient when all debater tools are disabled: the gateway returns `provider.auth` / `FreeTierError` before producing a proposal. The plugin retains the specified deny-all permissions and removes all tool declarations. There is no permission workaround or automatic paid substitution. A compatible upstream fix or an approved Phase 4 fallback is needed to run these debates. Free GLM can be slow. Model availability is checked before creating children; missing models fail with a configuration pointer. Two models agreeing does not establish correctness. The open-ID stalemate rule can stop a debate even when their arguments have become more detailed. Debaters have no tools, browsing, or independent fact verification. Treat relayed context as debate material rather than trusted instructions.

The v2.0.32 Promise plugin adapter ignores request-option abort signals. This plugin races its own signals, explicitly interrupts children, and prevents a late-admitted prompt from overlapping a retry. Child sessions are retained on error/cancellation for inspection. If the server itself is unreachable, interrupt acknowledgment can fail; the log records that diagnostic. A process kill, machine failure, or unwritable disk cannot guarantee a final cancellation log.

V2 uses `session.prompt({ sessionID, text })`, then wait/context reads; it does not return an answer from prompt admission. Some wait endpoints are experimental. The implementation targets the pinned release and needs testing before upgrades. See `docs/FINDINGS.md` for source-level evidence and known historical hanging-prompt issues.

Development checks: `npm run check` runs typechecking and the scripted core, mocked v2 transport, plugin registration, configuration, and private-log tests. `npm run install:preview` performs no installation. The [integration report](docs/INTEGRATION.md) distinguishes actual provider failures from passing tests with an injected pre-dispatch delay. In OpenChamber, inspect children through the calling session's **Subagents** panel; that parent-child relationship was verified. No deadlock occurred in the exercised failure, timeout, or cancellation paths; successful multi-round provider execution remains unverified.
