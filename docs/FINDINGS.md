# opencode-debate — Phase 0 findings and implementation proposal

Investigated on October 20, 2026. **Historical Phase 0 snapshot:** no debate implementation or OpenCode configuration changes had occurred at that point. Later observations appear as addenda below. For current implementation, permissions, logging, and completed phases, use [README.md](../README.md), [SPEC.md](SPEC.md), and [PHASES.md](PHASES.md); they supersede the initial implementation proposals in this document.

Repository requested and confirmed by the user: `~/dev/opencode-debate`, resolving to `/Volumes/Samsung-Ext/dev/opencode-debate`. The originally attached empty `dev/me/openchamber-debater` directory is not the target repository.

## Evidence and confidence

The installed version is **OpenCode 2.0.32**, which has a substantially different API from OpenCode 1. The requested `@opencode-ai/plugin` / `@opencode-ai/sdk` design is a V1 design. It must be adapted to V2 rather than copied verbatim.

Evidence inspected:

- Installed CLI `/Users/johnlevander/.opencode/bin/opencode --version`: `opencode v2.0.32`.
- OpenChamber's bundled CLI `/Applications/OpenChamber.app/Contents/Resources/opencode-cli/opencode --version`: the same version.
- Running process paths: a background OpenCode service and a separate OpenChamber-managed server using the bundled executable. These are separate server processes; do not assume they are interchangeable.
- Background service `server.info`: version `2.0.32`.
- Read-only background service OpenAPI schema, model inventory, and supported CLI model listing.
- Existing global `opencode.jsonc` and the `plugins/free-only/index.ts` implementation: already use V2 `plugins`, `Plugin.define`, and model transforms.
- Official `@opencode/plugin`, `@opencode/client`, and `@opencode/schema` **2.0.32** npm packages, extracted to temporary storage and inspected, including their `.d.ts` declarations and implementation. No dependencies were installed globally or in this repository during Phase 0.
- Exact upstream source tag `v2.0.32`, commit `843a6c514e606b436a7fe713422ace0a93ad3d61`, particularly config discovery, plugin host/adapter, agent registry, session admission, execution coordinator, and built-in subagent implementation.
- Official V2 documentation, checked against that pinned source wherever behavior mattered.

**Installed declaration limitation:** the inspected installation is a compiled executable, not an unpacked installation of the two V1 npm packages. I did not find loose installed declarations for `@opencode-ai/plugin` or `@opencode-ai/sdk` in the checked config/cache/global-package locations. I therefore inspected the official declarations matching the actual installed V2 version. I am not claiming to have read unavailable installed V1 declarations.

Temporary research material is under `/private/tmp/opencode-debate-investigation/`. Raw service configuration, credentials, model-account headers, and API captures are deliberately excluded from this repository.

## 1. Version and plugin runtime

The terminal CLI and OpenChamber's bundled CLI are both **2.0.32**. OpenCode runs plugin TypeScript/JavaScript in its **embedded Bun runtime**. A separately installed `bun` executable is not required to load the plugin; none was found on this shell's PATH.

The matching plugin package uses `Bun.Transpiler` for source scanning and `Bun.plugin` to provide host runtime modules. Its runtime rejects foreign copies of protected host modules such as `effect` and `@opencode/plugin` when inappropriate. Compile/bundle output should therefore leave host imports external. The exact embedded Bun patch version was not established.

For this installation, use `@opencode/plugin` and, for development types as needed, `@opencode/client` / `@opencode/schema`, pinned to `2.0.32`. The Promise plugin context itself exposes session methods: there is no V1 `ctx.client` property to destructure.

Sources: [plugin runtime](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/plugin/src/runtime.ts), [Bun source loader](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/plugin/src/source.bun.ts), [V1 plugin migration](https://opencode.ai/v2/docs/build/plugins/migrate-v1).

## 2. Plugin/tool directories and registration

| Resource | Project | Global | Status in 2.0.32 |
| --- | --- | --- | --- |
| Plugins | `.opencode/plugins/` | `~/.config/opencode/plugins/` | Preferred plural spelling |
| Legacy plugins | `.opencode/plugin/` | `~/.config/opencode/plugin/` | Both spellings are scanned |
| Custom tool files | No verified V2 `tool/` or `tools/` autoload API | No verified V2 `tool/` or `tools/` autoload API | Register tools through a plugin transform |
| Agents | `.opencode/agents/` | `~/.config/opencode/agents/` | Both `agent/` and `agents/` are scanned |
| Commands | `.opencode/commands/` | `~/.config/opencode/commands/` | Both `command/` and `commands/` are scanned |

The plugin scanner examines direct `.ts`/`.js` entries and immediate package directories. Config discovery includes global config and ancestor project `.opencode` directories. Prefer one plugin package directory with its supporting modules inside it, so helpers are not independently discovered as plugins.

**Pinned-source discrepancy with current docs:** in 2.0.32, an explicit absolute plugin config path that points to a file is warned about and ignored by `config/plugin/source.ts`. Use a **directory** in `plugins`, with a resolvable package entrypoint. Do not rely on documentation examples showing configured absolute `.ts` file paths. Automatic directory scanning has its own direct-file handling.

Exact V2 registration shape, shown only as a documentation example:

```ts
import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "opencode-debate",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "debate",
        description: "Run a debate only when the user explicitly requests one.",
        input: {
          type: "object",
          properties: { question: { type: "string" } },
          required: ["question"],
          additionalProperties: false,
        },
        options: { codemode: true, pinned: true },
        async execute(input, context) {
          // Validate application constraints, then invoke the protocol engine.
          return { content: "Rendered debate result" }
        },
      })
    })
  },
})
```

The transform callback is synchronous and replayable. One-time work belongs in setup or execute, not in the transform. Tool input may use JSON Schema; a Promise executor returns `Tool.Result`, including `content`, optional typed `output`, and optional `metadata`. It does not return the old standalone string tool result.

Sources: [plugin scanner](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/plugin/source-directory.ts), [configured plugin sources](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/config/plugin/source.ts), [tool declarations](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/plugin/src/promise/tool.ts), [tool schema](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/schema/src/tool.ts).

## 3. Tool execute context

The matching Promise `ToolContext` provides:

| Field | Meaning |
| --- | --- |
| `sessionID` | Session invoking the tool; use as child `parentID` |
| `agent` | Invoking agent ID |
| `messageID` | Message associated with the tool call |
| `id` | Tool call ID; not named `callID` in this API |
| `signal` | `AbortSignal` for tool execution |
| `progress(update)` | Asynchronous metadata/progress update |

It does **not** declare a working directory, client, or V1 `ask()`/`metadata()` helper on the executor context. Capture the plugin context in setup. `ctx.location.directory` is the plugin instance location; for session-specific location, inspect the parent session or let child creation inherit it. Permission requests are on `ctx.permission.assert(...)` if needed.

Sources: [Promise ToolContext](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/plugin/src/promise/tool.ts), [base Tool.Context](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/schema/src/tool.ts).

## 4. Session creation and nesting

`ctx.session.create(input?)` returns a **SessionInfo directly**, not `{ data: SessionInfo }` in the Promise API. Its accepted creation fields are:

```ts
{
  id?: string,
  parentID?: string,
  title?: string,
  agent?: string,
  model?: { providerID: string, id: string, variant?: string },
  location?: { directory: string },
  metadata?: Record<string, JsonValue>,
  permissions?: Array<{ action: string, resource: string, effect: "allow" | "deny" | "ask" }>
}
```

Create the two debaters like this conceptually:

```ts
const child = await ctx.session.create({
  parentID: context.sessionID,
  title: "Debate — Proposer",
  agent: "opencode-debate-internal",
  model: { providerID: "opencode", id: "glm-5.3-flash-free" },
})
```

A child inherits its parent's location. The core creation type treats `parentID` and explicit location as alternatives; the plugin host uses the parent's location when `parentID` is supplied. Root sessions default to the plugin location when no location is given. There is **no top-level `directory` creation field**.

Child creation also inherits parent metadata and session permissions unless explicitly replaced. It does not copy the conversation transcript. Explicitly select model and agent; do not depend on implicit model inheritance in raw session creation.

`parentID` is the actual backend relationship used for subagent sessions. This establishes nesting data, but **OpenChamber's rendering of plugin-created children has not been exercised**. Both child titles and IDs should appear in the returned result so they remain accessible even if the front end does not display them as expected.

Sources: [Promise client declarations/source](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/client/src/promise/generated/client.ts), [plugin host session methods](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/plugin/host.ts), [session creation](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/session.ts).

## 5. Prompting, completion, text, reasoning, and cancellation

Neither proposed V1 shape is correct for this release. V2 accepts a **flat prompt input with text**, not `path/body` or `parts`:

```ts
const admitted = await ctx.session.prompt({
  sessionID: child.id,
  text: "The next debate turn, assembled from src/prompts.ts",
  delivery: "queue",
})
await ctx.session.wait({ sessionID: child.id })
const messages = await ctx.session.context({ sessionID: child.id })
```

Other prompt fields are optional `id`, `files`, `agents` (mentions/attachments), `skills`, `metadata`, `delivery`, and `resume`. **There is no per-prompt `model`, scalar `agent`, or `variant`.** The plural `agents` attachment field does not select the running agent. Set agent/model at creation; subsequent changes use `session.switchAgent({ sessionID, agent })` and `session.switchModel({ sessionID, model: { providerID, id, variant? } })` before admitting a turn.

The model reference uses **`id`**, not `modelID`. Reasoning variants go inside that model reference. Both requested models currently advertise `low`, `high`, and `max`. No reasoning variant was requested, so the proposed default is to leave it unspecified and record the resolved selection.

`session.prompt()` returns **SessionInboxUser**, an admitted input with `id`, `sessionID`, `type: "user"`, payload, time, and delivery. It returns promptly after admission; it is not an assistant answer. `session.wait()` returns `void` after the runner becomes idle; its HTTP endpoint is experimental. `session.context()` returns `SessionMessageInfo[]` directly.

Assistant messages have `type: "assistant"`, `content`, `time.completed`, `finish`, model/agent, and optional `error`. Content entries distinguish `{ type: "text", text }`, `{ type: "reasoning", text }`, and tool entries. Capture the previous message boundary and admitted input ID; after waiting, locate the new completed final assistant message for that turn and join **only its text content**. Do not concatenate old replies or reasoning. The built-in subagent completion code follows the same text-only extraction principle. Treat absent final text, error messages, length truncation, and failed/interrupted session outcomes as failures or bounded retry cases; idle alone does not establish success.

Cancellation is `ctx.session.interrupt({ sessionID, resume: false })`, returning `{ interrupted: boolean }`. There is no V1 `session.abort` method here. Interrupt acknowledges acceptance before cleanup settles; a bounded subsequent wait/context inspection is needed if settlement matters. Cancel both plugin-owned children when the parent signal aborts or the overall deadline expires.

**Important 2.0.32 discrepancy:** Promise client declarations expose a second `RequestOptions` argument containing `signal`, and the HTTP client honors it. However, the installed-version **in-process Promise plugin adapter's `adaptApiMethod` takes only one input argument and does not forward request options**. Do not assume `ctx.session.wait(input, { signal })` cancels a plugin-local wait. Use an application deadline/abort race plus explicit child interruption and handle late promises. This behavior is established by source inspection; a runtime regression test is proposed before relying on it operationally.

Sources: [generated prompt/client implementation](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/client/src/promise/generated/client.ts), [session admission and wait](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/session/session.ts), [Promise adapter](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/plugin/src/promise/adapter.ts), [message schema](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/schema/src/session-message.ts), [text-only subagent completion](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/session/subagent-completion.ts).

## 6. Agents, visibility, and plugin injection

V2 supports `agents` entries in `opencode.json` / `opencode.jsonc`, or Markdown files with YAML frontmatter and a system-prompt body. Global/project directories are listed above; singular agent directories are accepted for compatibility. V2 JSON uses `system`, `permissions`, and `disabled`, rather than the old `prompt`, `permission`, and `disable` keys.

Modes are `primary`, `subagent`, and `all`. Use a dedicated internal agent with **`mode: "subagent"` and `hidden: true`**, selected explicitly when creating children. Mode alone is not a universal hiding mechanism. Hidden removes normal interactive discovery; it is not an access-control boundary. The core registry resolves an explicit ID without excluding hidden agents. Hidden maintenance agents exist, so do not infer that hidden automatically means uncallable through the session API. This exact custom-agent path still needs a smoke test in OpenChamber.

There is no V1 global `config` hook. The plugin can register its agent through **`ctx.agent.transform`**. In the pinned implementation, `editor.update(id, callback)` creates a default agent if the ID is missing, then applies the callback. Set its system prompt, name/description, hidden flag, mode, and permissions there. Thus no global agent file is needed.

Debater agents should have no tools exposed for debate turns. Use explicit denial rules and a narrowly scoped session context hook that clears tools only for sessions owned by this plugin. This prevents recursive `debate`, file edits, shell use, question prompts, and accidental third-party calls. Prompts alone are insufficient to enforce this. All agent system text must come from `src/prompts.ts`.

Sources: [agents documentation](https://opencode.ai/v2/docs/agents/), [agent registry and update behavior](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/agent.ts), [agent config loader](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/config/plugin/agent.ts), [agent config schema](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/schema/src/config/agent.ts).

## 7. Commands

Preferred command locations: `.opencode/commands/<name>.md` and `~/.config/opencode/commands/<name>.md`. Singular `command/` is also scanned. The trimmed Markdown body is the prompt template; optional YAML frontmatter supplies `description`, `agent`, `model`, and `subagent` (`subtask` is a legacy alias). JSON uses the plural `commands` map with a required `template`.

`$ARGUMENTS` expands the complete invocation argument text; `$1`, `$2`, etc. support positional arguments. A Markdown command normally expands a prompt, rather than deterministically executing a tool. Setting `subagent: true` creates a background child; that is not the desired debate loop orchestrator.

Proposed user entrypoint: `/debate <question>`. A plugin command registered with `ctx.command.transform` can run a deterministic handler and call the same core service as the `debate` tool. This provides an unambiguous explicit request without asking a model to control the loop. If a Markdown command is desired instead, generate its body from `src/prompts.ts` and document that the model still decides to issue the initial tool call.

**Explicit-request enforcement needs a concrete policy:** a tool description alone cannot prove user consent. Proposed behavior is a deterministic opt-in marker such as `/debate` or an explicit `debate:` prefix, tracked against the originating user message; reject unsolicited tool calls and recursive child calls. Arbitrary natural-language intent cannot be recognized perfectly by deterministic code. Confirm the accepted opt-in syntax before implementation.

Sources: [commands documentation](https://opencode.ai/v2/docs/commands/), [command loader/executor](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/config/plugin/command.ts), [command plugin types](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/plugin/src/promise/command.ts).

## 8. Exact model IDs

The requested command was attempted:

```text
opencode models opencode --refresh
ERROR: Unrecognized flag: --refresh in command opencode models
```

V2 help shows `opencode models` with optional `--server` / `--standalone`; it has neither the V1 provider positional argument nor the refresh flag. I used `opencode models --server <existing-background-service-url>` and filtered its output for `free`, then checked the read-only server inventory.

Relevant actual output:

```text
opencode/deepseek-v4.1-flash-free
opencode/glm-5.3-flash-free
```

| Role-independent key | Provider ID | Model reference ID | Enabled | Listed cost | Variants |
| --- | --- | --- | --- | --- | --- |
| `glm` | `opencode` | `glm-5.3-flash-free` | true | Input/output/cache all zero | low, high, max |
| `deepseek` | `opencode` | `deepseek-v4.1-flash-free` | true | Input/output/cache all zero | low, high, max |

Both advertise text output, tool capability, 200,000-token context, and 32,000-token output limits. These are an inventory snapshot, not a guarantee of future availability or service performance. The global free-only plugin disables nonzero-cost models and global policies allow only `opencode`. Re-check both exact models on the actual hosting server at run start; fail clearly if unavailable, and never silently substitute a paid model.

No refresh was claimed: the requested refresh mechanism is absent in this version. No inference calls were made during Phase 0. The user's observed direct-API `FreeTierError` was not independently reproduced; the proposed adapter stays inside OpenCode session execution.

## 9. Same-server execution and hanging-prompt risks

**Supported by the source architecture:** a tool running in session A can create sessions B/C on the same server and wait while those children run. `SessionRunCoordinator` serializes each session key separately and explicitly permits different keys to execute concurrently. The built-in foreground `subagent` tool creates a child with `parentID`, admits its prompt, starts work, waits, and extracts a result while its parent tool remains active.

**Limits of this finding:** this is source-backed feasibility, not a completed end-to-end test of this new plugin, these two providers, or OpenChamber's UI. No temporary plugin was installed and no live conversation or model was prompted.

Risks to address:

1. Never wait for A from inside A's active tool; never make children depend on parent completion. Wait only on plugin-owned B/C, one outstanding turn per child.
2. Prompt admission is not completion. Preserve turn boundaries and inspect outcome/error/final text after waiting; `awaitIdle` intentionally ignores execution errors while waiting for settlement.
3. Parent cancellation does not constitute a proven automatic child-cancellation guarantee. Register explicit cleanup for both children, use per-turn and overall deadlines, and handle a child created after an abort race.
4. The Promise adapter's ignored request options mean signal-based timeout examples may leave the underlying operation alive. A deadline must interrupt the child, not just stop awaiting its Promise. Bound cleanup too.
5. Permission/question requests, tool recursion, provider retries, rate limits, and silent streams can keep a child busy. Remove debate-child tools, bound retries, record failure states, and do not turn a provider failure into a disagreement or convergence result.
6. Concurrent manual messages in debate children could contaminate turn matching. Treat unexpected user input/model changes as an interruption/conflict, not as debate evidence.
7. Do not create sessions or await prompts inside a replayable transform or startup hook that child activation itself needs. Register callbacks in setup, and run debates only after an explicit invocation.
8. The HTTP wait route is experimental; pin compatibility and test before upgrades.

Known upstream report: [issue #14565, queued prompt callers hanging on cancellation](https://github.com/anomalyco/opencode/issues/14565) describes a real historical pending-Promise problem. It is closed as completed; the discussion attributes remediation to the Effect/Runner migration. It is **not evidence that 2.0.32 still has that particular bug**. The installed source uses a different keyed coordinator. Bounded execution remains necessary regardless.

Sources: [per-session coordinator](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/session/run-coordinator.ts), [execution lifecycle](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/session/execution.ts), [built-in subagent flow](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/tool/plugin/subagent.ts), [Promise adapter](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/plugin/src/promise/adapter.ts).

## Proposed implementation phases — await approval

The request ended at `first: "glm" |`, so the remaining architecture and any later phase requirements have not been received. The following is a proposal, not a replacement for the missing specification.

### Phase 1: pure protocol engine and prompts

- Add `src/core/debate.ts` with no OpenCode imports. Inject a turn transport, deterministic role selection input/seed, clock, cancellation, and event sink. Default public runs choose a random role assignment in TypeScript once and record the seed/assignment; fixed seeds and `first` overrides make tests reproducible. Model outputs themselves remain nondeterministic.
- Put every model-facing template, agent system prompt, repair prompt, command prompt, and rendered instruction in `src/prompts.ts`.
- Use bounded, schema-validated JSON responses for proposals, objections, revisions, and explicit acceptance of a specific candidate version. Keep a stable issue ledger. No model can choose the next speaker, round budget, retry count, or termination state.
- Define a round precisely as a challenger review plus proposer revision, with the initial proposal separate. Converge only on validated mutual acceptance of the same candidate with no open objections. Detect unchanged/cyclic candidate-and-issue states by deterministic normalization/hashes and a fixed threshold. Do not use another LLM as judge. Phrase convergence as protocol agreement, not proof of correctness.
- Distinguish `converged`, `stalemate`, `max_rounds`, `cancelled`, and `error`. Nonconverged results include the last candidate and unresolved points with each model's position; failures cannot masquerade as consensus.
- Test the protocol using scripted transports: agreement, persistent disagreement, cycles, round limits, malformed/truncated JSON, bounded repair, retry exhaustion, reproducible assignment, and cancellation.
- Commit Phase 1 separately.

### Phase 2: OpenCode V2 adapter and plugin

- Add `src/opencode/adapter.ts` for child creation, fixed agent/model selection, prompt admission, bounded wait, turn-specific final text extraction, outcome/error checks, and explicit interrupt/cleanup.
- Add `src/index.ts` exporting the V2 plugin. Register `debate`, a hidden internal agent through `agent.transform`, narrowly scoped hooks, and the explicit command/gate. The tool and command call the same TypeScript service; neither asks a model to orchestrate.
- Give the two roles separate child sessions under the caller, clear tools for owned child requests, avoid modifying the parent's agent/model, and preflight the exact model IDs without fallback.
- Record role assignment, version, round/turn/retry/termination events, candidate/issue IDs, and child IDs. Do not log credentials, headers, or reasoning. Bound/redact diagnostic payloads; treat question/context/transcript persistence as potentially sensitive and make full transcript logging opt-in.
- Pin development types to 2.0.32, leave host runtime imports external, add typechecking and adapter tests for admission versus completion, stale messages, reasoning filtering, errors, ignored signal options, timeout races, and child cleanup.
- Commit Phase 2 separately.

### Phase 3: integration verification and installation instructions

- Verify loading and scripted transport behavior in an isolated config/data environment within the repository or temporary storage first.
- Exercise a minimal real run through OpenCode with both free models; verify same-server parent/child execution, exact resolved model IDs, hidden agent behavior, explicit invocation, cancellation, and deadlines. Confirm child-session display in OpenChamber. Do not describe these as tested until actually exercised.
- Add README usage, result examples, supported-version limits, tuning instructions, diagnostics, and uninstall instructions. Keep the prompt source centralized.
- Prepare the exact global config diff to add this repository's plugin **directory** while preserving the existing free-only plugin and policies. Show it and wait for approval **before** touching global config/plugin/command/agent directories. No automatic global installer.
- Commit Phase 3 separately; perform an approved global installation only if requested and authorized.

## Phase 0 completion boundary

Only this findings document and a minimal secret/dependency/log ignore file belong in the Phase 0 commit. No plugin code, global configuration edits, agent/command installation, service restarts, or model inference have occurred. Next step is the user's review, remaining architecture requirements, and explicit OK to begin implementation.


## Phase 3 addendum — observed on 2026-10-20

The Phase 0 inventory/source findings did not guarantee free-tier inference. Live OpenChamber tests now show that both configured free models reject the tool-free debater with `provider.auth` / `FreeTierError` inside OpenCode. [Upstream issue #51241](https://github.com/anomalyco/opencode/issues/51241) reports matching behavior with denied read/shell permissions. Its gateway-side cause remains outside this plugin's control. Keeping native OpenCode system context did not fix it. The required deny-all/no-tools behavior is retained. See [integration evidence](INTEGRATION.md); real convergence and contested point histories remain unverified.

The installed server can normalize an omitted reasoning variant to `"default"`; adapter matching treats those as equivalent. Explicit variants still require inventory support and exact matching. OpenChamber displays retained child sessions under the parent session's Subagents panel. A real UI Stop finalized a cancelled log and acknowledged interrupts for both children; the active child was stopped and the other was already idle. The UI displays Step interrupted because the parent step is cancelled too. Injected pre-dispatch delay tests verified deadlines and cancellation without a hanging parent. They do not prove remote-stream cancellation or successful multi-round provider execution.


## Code Mode discovery follow-up

OpenCode 2.0.32 partitions registered tools: `codemode: false` tools are advertised directly and excluded from Code Mode's runtime/search inventory. An empty Code Mode search therefore does not prove a direct tool is unloaded. The user reproduced this confusion in a build session whose project reported opencode-debate active. The plugin now registers `options: { codemode: true, pinned: true }`. The installed `@opencode/schema` tool options support both fields; pinning retains the signature in the inline catalog even when its normal budget is exhausted. The command still requires explicit user invocation.

Sources: pinned-version [tool snapshot](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/tool.ts), [Code Mode runtime](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/codemode/tool.ts), and [catalog selection](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/codemode/catalog.ts). An isolated 2.0.32 server loaded the changed plugin; a context hook recorded the registered options, an advertised execute tool, and a debate signature in the assembled catalog instructions, then deliberately stopped before inference. This verifies catalog exposure, not a new live-model debate.

## Current implementation cross-reference — 2026-10-21

All four implementation phases are complete. The approved opt-in restricted-read mode enabled actual free-model IEEE convergence and three two-round coding debates through OpenChamber; strict no-tools mode still has the recorded free-tier rejection. The coding tests exercised objections, revisions, role repair, a real timeout retry, and cancellation, and exposed a false promise-timing claim accepted by both models. Production fallback inference remains unverified. The [integration report](INTEGRATION.md) preserves the chronological evidence and its limits.

The original mutual-acceptance/hash stop proposal, opt-in transcript logging, deterministic invocation-marker proposal, and proposed file layout were superseded. The engine uses Challenger endorsement and repeated open-ID sets, with optional minimum rounds; it logs full text and available reasoning privately, relays only validated JSON, and registers a pinned Code Mode tool plus generated Markdown command. Natural-language invocation consent remains an instruction to the caller, while recursive debater invocation is rejected. Current HTTP status/error-envelope classification, bounded retry-body reads, header/body hints, and regression coverage are documented in the [retry guarantees](../README.md#protocol-and-retry-guarantees).

## Exact result delivery — 2026-10-21

The caller rewrote or omitted transcript text in all three coding debates despite passthrough instructions. OpenCode 2.0.32's [Code Mode implementation](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/codemode/tool.ts) collects base64 file parts separately from the code's returned text and includes them in the outer execute tool's stored content. The plugin now returns an identical original Markdown file alongside its text result, with SHA-256 and UTF-8 byte count in metadata and the final journal. This provides exact output independently of caller-generated prose; it does not force that prose to be identical.

Markdown is not a supported media type for every provider. A session context hook replaces only the plugin's matching, hash-checked original-result attachments with a text reference for model input. Stored conversation content retains the file. No extra filesystem permissions, debater tools, or code execution are introduced. Results are explicitly marked not independently verified; stronger counterexample and evidence prompts do not make model agreement proof of correctness.

The later [five maximum-round tests](LOGIC_STRESS.md) completed eight rounds each and verified original attachments up to 168,754 bytes. They also exposed an incorrect iterator answer surviving agreement and 88 read attempts rejected by the guard, including 63 in one timed-out turn. Native child histories retain those individual tool steps; the journal's logical attempt count is not a count of native model/tool steps. A separately reproduced direct-core timer overflow was fixed by aligning core timeout validation with the already bounded configuration.
