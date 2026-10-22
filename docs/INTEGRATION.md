# Phase 3 integration results

Current status, 2026-10-22: this document preserves chronological live-test evidence. The initial strict no-tools trials failed; the later [approved restricted-read experiment](#approved-restricted-read-compatibility-experiment--2026-10-20-evening-americanew_york) achieved free-model IEEE convergence through the installed tool. Later coding tests completed three two-round debates and exposed a false-consensus detail and caller transcript changes; see the coding-debate section below. The optional fallback is implemented and mock-tested, and compatibility mode was subsequently approved for global activation; see [phase reports](PHASES.md). The [failure audit](FAILURE_AUDIT.md) added deterministic fault coverage; the subsequent [five-case live verification batch](VERIFICATION_LIVE.md) completed eight rounds each with final passing independent output checks. Earlier approval boundaries and test counts below describe those milestones, not pending work.

Tested 2026-10-20 with OpenCode 2.0.32 and the installed OpenChamber front end. The approved global plugin and command symlinks point to this repository. Global `opencode.json(c)` and agent files were not edited. Both free model IDs were available in the server inventory.

## Outcome

The plugin loads and the control paths work, but the requested free-model debates cannot currently produce an opening answer. Actual child requests inside OpenCode fail with `provider.auth` / `FreeTierError`. The required hidden `debater` has deny-all permissions and no outgoing tool declarations. This behavior matches [OpenCode issue #51241](https://github.com/anomalyco/opencode/issues/51241), which reports free-tier rejection when read/shell tools are denied. The exact gateway decision is not visible locally; the upstream match is a diagnosis, not proof of its internal implementation.

No tools were enabled or fabricated to bypass that restriction. No paid requests were made. Phase 4 has not started.

## Test results

| Case | Execution | Observed result | Rounds / point history |
| --- | --- | --- | --- |
| IEEE 754: does 0.1 + 0.2 exactly equal 0.3? | Actual `/debate` from OpenChamber | `error`: FreeTierError during P0; repeated with the other model proposing, same failure | 0 / `[]`; convergence unverified |
| Mature open-source scientific software: strict backward compatibility versus breaking API changes | Actual debate tool from OpenChamber | `error`: FreeTierError during P0 | 0 / `[]`; meaningful disagreement/stalemate unverified |
| `callTimeoutMs: 1000` | Real plugin/SDK/UI with an isolated 30-second pre-dispatch delay | `error`: Call timeout after 1000 ms; initial attempt ~1004 ms, retry ~1012 ms; retry carries the required interruption prefix; JSON log written | 0 / `[]` |
| Stop from OpenChamber while a child waits | Real plugin/SDK/UI with the same isolated delay and normal deadlines | `cancelled` log; interrupt requests acknowledged for both children; active Proposer stopped, unstarted Challenger already idle | 0 / `[]` |

The IEEE parent is `ses_ea5df663cffeSFsNJwOYurrrSM`. The contested case used the same parent. The timeout parent is `ses_ea5d70a45ffeLqrrG2JXMGSRRr`; cancellation parent is `ses_ea5d4ab1effeXFU2CZmr83Z8lS`.

The parent session stayed responsive while child work was pending. The timeout tool returned a clean result and the parent finished normally. The UI Stop action stopped the parent step too: OpenChamber displayed “Step interrupted,” while the plugin still finalized its `cancelled` JSON log. This means a UI cancellation does not display the normal result Markdown. Both children appeared under the parent's **Subagents** panel and showed Done afterward. This verifies that relationship, not sidebar indentation.

After the delay's 30-second window elapsed, SDK history reads showed the active children had `outcome: interrupted`, ending in idle events, with no assistant answer. The unstarted Challengers had empty histories. These reads confirm the tested delayed operations did not later produce answers. No deadlock was observed in these paths; the upstream failure prevented verification of successful multi-round provider execution.

![OpenChamber after Stop: interrupted parent and two completed child entries](screenshots/openchamber-cancellation.png)

## Evidence and scope

Full logs remain outside Git in `~/.local/share/opencode-debate/debates/`:

- IEEE: `2026-10-20T16:24:10.232Z-in-ieee-754-double-precision-does-0-1-0-2-exactly-equal-0-3-expl-9a0d6ff1.json`
- IEEE diagnostic rerun: `2026-10-20T16:27:35.008Z-in-ieee-754-double-precision-does-0-1-0-2-exactly-equal-0-3-expl-f3a2224e.json`
- Contested: `2026-10-20T16:32:03.545Z-should-a-mature-open-source-scientific-software-project-prioriti-fc7982fa.json`
- Timeout: `2026-10-20T16:34:12.785Z-integration-fixture-confirm-the-1000-ms-call-timeout-returns-a-c-c1dbd279.json`
- Cancellation: `2026-10-20T16:36:36.759Z-integration-fixture-cancellation-while-a-child-waits-before-disp-2f94f19d.json`

Timeout children: GLM `ses_ea5d62d45ffewmhGR7hbKTNluv`, DeepSeek `ses_ea5d62cfcffeW0d2BuQo62oIpN`. Cancellation children: GLM `ses_ea5d3fadeffe4X2NP1KWj9Yz5a`, DeepSeek `ses_ea5d3fa94ffe9vRQT3NB8EXT7q`. Every child retains the calling session as `parentID`.

The isolated delay fixture was in the ignored repository `.test-runtime/live-control/.opencode` directory. Its local plugin waited 30 seconds in the debater context hook before dispatch, recording `tools: []`. This exercised genuine SDK waits, engine deadlines, explicit child interruptions, logging, and the OpenChamber Stop action without depending on provider latency. It does **not** establish remote-stream cancellation or real-model agreement. The local `.opencode` fixture directory was renamed to `.opencode-disabled` after the tests so future activation does not load it. Sessions and logs were retained.

Automated isolation remains separate: `npm run check` passes TypeScript and the full core/adapter/plugin/config/log suite, including scripted convergence, revisions, stalemate, maximum rounds, parser repair, role/ID validation, rate-limit/outage classification (including permanent-status precedence over outage wording and interrupted HTTP-200 bodies) and shared retry budgets across repairs, timeout/cancellation, ignored SDK signals, and late admission/results. An isolated OpenCode server also verified plugin/agent/command registration before global installation.

## Changes prompted by live testing

- Accept the server's normalized `variant: "default"` when configuration omits a variant; retain validation for actual model/variant changes. Added a regression test.
- Preserve OpenCode's assembled system context while clearing debater tools; the agent still uses the specified system prompt. Preserving that context did not resolve FreeTierError.
- Write per-child interrupt request times, acknowledgment times, returned `interrupted` flags, and acknowledgment errors to final logs. Both timeout/cancellation tests check these records.

Phase 3 is reported with blocked provider acceptance. Approval is required before implementing Phase 4's OpenAI-compatible adapter and mock-server tests. That work would add a selectable backend; it would not itself authorize live paid inference.


## User reproduction — 2026-10-20, 8:06 PM America/New_York

The user's later free-only run reproduced the failure on OpenCode 2.0.32. Log `2026-10-21T00:06:31.445Z-what-is-the-best-microphone-under-50-for-vocal-singing-live-04981d33.json` records DeepSeek as Proposer, GLM as Challenger, zero Challenger rounds, and provider.auth during P0 after 250 ms. Both child interrupt requests were acknowledged as already idle. This is additional evidence of the same rejection, not a successful debate. No paid key/provider is implied by this error alone.

The adapter now appends a specific explanation to this recognizable free-tier error: the request already used an OpenCode child, tool-disabled requests have a reported compatibility issue, and changing tool permissions requires approval. Unrelated authentication errors retain their original diagnosis. Two regression tests cover that distinction. The default remains the user's explicitly selected free OpenCode backend; no permissions were relaxed, no global settings were changed in this diagnostic patch, and no paid inference was performed.


## Approved restricted-read compatibility experiment — 2026-10-20, evening America/New_York

The user approved testing an exception to the original all-tools-disabled requirement: expose only native read, limited to a plugin-owned empty file, while denying all other tools. No global compatibility configuration was changed during the trial.

### Isolation and single-model probe

A repo-local plugin under ignored `.test-runtime/read-compat/` defined a separate hidden test agent and preserved the genuine native read tool. Real `ctx.permission.assert` checks allowed only `empty.txt`, denied `canary.txt`, denied directory reads, and denied shell. A tool-execution guard checked the exact path and verified a zero-byte regular file. The DeepSeek probe succeeded in child `ses_ea42f6dd4ffefjN7NNqwstgkH8` under parent `ses_ea42f6ed9ffeakF24kVwX3LrXe`.

The same isolated agent then completed a real engine debate: DeepSeek P0, GLM C1, status `converged`, one Challenger round, no points. Parent `ses_ea42ca6cfffecNjhznJcZz4w7N`; GLM child `ses_ea42ca56effevEKlz4z9O9ZJYd`; DeepSeek child `ses_ea42ca499ffeukJC0GtuoZ7rwD`. A preceding attempt encountered a transient provider HTTP 429 endpoint-unavailable error; bounded retries were used on the successful attempt. This was real free inference, not scripted model output.

### Actual installed debate tool

After implementation of opt-in `readCompatibility`, a separate repo-local test project `.test-runtime/plugin-read-compat/` enabled it with `low` reasoning variants. The free DeepSeek calling agent invoked the actual installed `debate` tool on OpenChamber's server. Parent `ses_ea428b090ffeo6uM3FMSsnTI2W` returned normally and the result was inspected in the OpenChamber UI.

Log: `2026-10-21T00:23:58.883Z-in-ieee-754-double-precision-does-0-1-0-2-exactly-equal-0-3-expl-eaa001cc.json`. It records `converged` after C1, DeepSeek as Proposer and GLM as Challenger, and empty C1 point history. P0 recovered from two provider rate-limit errors using the engine's bounded retry path. GLM child `ses_ea4281752ffednsJjpZ5cxSpvS`; DeepSeek child `ses_ea42816f0ffe9y5N7OXbLOgk9B`. Both models were the requested free OpenCode IDs. The caller displayed the answer and reported no unresolved points. As previously observed, the calling model can reformat the final presentation even though the tool itself returns the specified Markdown.

A preceding actual-tool attempt, log suffix `c778b283`, ended cleanly after exhausting three endpoint-unavailable attempts. This is separate from the original auth rejection and remains a possible free-service limitation.

The audit hook confirmed each child request advertised exactly `read`. Actual permission checks allowed the asset path and denied a canary file, the current directory, and shell. No debater tool executions occurred in the successful IEEE run. The permanent asset is `assets/compatibility/empty.txt`; its path is recorded in child-session log entries. Unit tests additionally verify symlink/content changes, nearby instruction-file loading, absent native read, hook cleanup, default-off behavior, and unchanged parent tools. TypeScript and all 66 tests pass.

![Actual free-model debate converged after one review round in OpenChamber](screenshots/openchamber-free-converged.png)

Source checks used the exact v2.0.32 [permission evaluator](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/permission.ts), [tool availability filter](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/tool.ts), [file authorization](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/file-access.ts), and [native read implementation](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/tool/plugin/read.ts). Session rules follow agent rules, the last matching rule wins, and native read performs its own authorization. Its instruction-file side effect is explicitly guarded by this plugin.


### Contested question in compatibility mode

The actual tool was also tested on scientific-software backward compatibility versus breaking API changes, parent `ses_ea4263454ffeb5M2nKLcMg2Edx`, with GLM proposing and DeepSeek challenging. Log: `2026-10-21T00:26:20.259Z-should-a-mature-open-source-scientific-software-project-prioriti-ca64687a.json`.

The free models produced P0 and C1, so the original auth blocker was absent. C1 introduced seven open points: unclear compatibility tiers, silent semantic/default changes, unmaintained pipelines and frozen environments, numerical correctness versus bit identity, ABI compatibility, questionable examples, and maintainer capacity. P1 returned malformed JSON, then its single JSON repair returned a Challenger-style reply with a null answer. The engine correctly stopped with `error: Invalid JSON twice in P1: Proposer must provide a nonempty answer`, preserving the last valid proposal and all seven open points. Point history is `C1: C1–C7 open`; no revision was accepted, so every Proposer point position remained Not yet addressed. This was not convergence or stalemate, and successful multi-round contested debate is still unverified. C1 recovered from two transient provider rate limits.

The caller displayed the partial answer and unresolved points. This exposes a remaining free-model output/role adherence limitation, distinct from transport authentication. The protocol did not silently accept missing answers or let Proposer output close Challenger objections. No prompt-policy change or retry-budget expansion was made just to force a successful outcome.

After testing, both ignored test fixture `.opencode` directories were renamed `.opencode-disabled` to stop loading their local audit plugins/config on future activation. Logs and sessions are retained. The actual acceptance caller and both IEEE child sessions reported `cost: 0` and the expected free model IDs. The global compatibility flag remains off pending the user's approval of the exact config merge.

## Automated verification update — 2026-10-21

The current source passes TypeScript and all 228 automated tests. Coverage now includes statusless outage/rate-limit classification, permanent-status precedence, Retry-After whitespace/header handling, nested/top-level body retry hints on HTTP-200 envelopes and HTTP 429/503, engine backoff/history isolation, and malformed/oversized/interrupted/stalled error bodies. Optional retryable-error body reads are bounded to 64 KiB and one second; valid headers win, and permanent errors skip inspection. Progress callback failures/non-Promise returns, native initialization/idle errors, interrupt diagnostics, journal failures, argument/configuration guards, and concurrent tool execution also have regression coverage.

This is local automated evidence; no new live-model run, provider availability check, paid inference, or OpenChamber restart was performed for the hardening changes. Historical live-test outcomes and limits above remain unchanged.

## Coding debates and issue reproduction — 2026-10-21

The installed `/debate` command and actual pinned tool ran through OpenChamber on source commit `6028356`. Both participants used the original free OpenCode IDs. All three complete cases requested `min_rounds: 2` and ran P0/C1/P1/C2:

| Case | Parent session | Result | Observations |
| --- | --- | --- | --- |
| Single-flight async cache, stale invalidation, and rejection handling | `ses_e9fecda1dffeFIfqGiwyq2m1OB` | Converged, 390.09 s | One Challenger role repair; two objections resolved. A false promise-timing detail survived agreement. |
| Binary-search upper bound with signed-bitwise midpoint overflow | `ses_e9fea2793ffeaSS6i6jaOtE836` | Converged, 242.81 s | One real 120-second timeout recovered. Attempted read of `/dev/null` was denied. |
| Async mutex releasing before the awaited critical section finishes | `ses_e9fe9a753ffeO0EQMKn7sB1B45` | Converged, 138.82 s | Correct lost-update diagnosis and fix; early agreement still honored the two-round minimum. |
| Dedicated cancellation control | `ses_e9fe65f87ffemTCck2PC5jrPuc` | Cancelled, 11.86 s | Both child interrupt requests acknowledged; cancelled journal finalized. |

All parents/children reported zero cost and were idle after testing. The cache test used existing global/default reasoning settings; the others used a repo-local ignored configuration with low variants, 120-second call timeouts, and a ten-minute total deadline. Global settings were unchanged. Independent Node checks exercised the proposed cache/mutex fixes and 3,670 binary-search boundary/duplicate cases. Two concurrent debates completed independently, and no recorded reasoning block was found replayed in the opponent's logged prompts.

Three issues were reproduced:

1. A real `RestrictedRead.create` refusal with a sibling `AGENTS.md` was converted into a connectivity outage: three initialization attempts, two backoffs, zero children, and the useful local cause lost. It now stops once as a permanent transport/configuration failure, preserving the guard diagnostic. Regression coverage also distinguishes declared SDK errors, malformed responses, permanent HTTP errors, and genuine network/SDK transport outages.
2. Both models accepted the wrong assertion that a finally-derived promise is already rejected during an earlier catch on the original promise. A Node.js 24 check instead recorded `cleanup`, then `caller catch; derived=Promise { <pending> }`, then `derived catch`. Cleanup invocation and derived-promise settlement are different events. Prompts now require independent mechanism/counterexample checks, and every result is explicitly not independently verified. This mitigates misplaced certainty; it cannot guarantee correct model answers.
3. Every calling-model reply changed the saved tool output; the binary case omitted all four transcript JSON replies. The tool now includes an identical original Markdown attachment collected separately by native Code Mode, plus its name, SHA-256, and byte count in metadata/journal. A provider-context hook keeps the unsupported Markdown media out of model input while retaining the saved attachment.

Private questions, raw reasoning, histories, executable checks, and the original test report remain in ignored `.test-runtime/coding-debates/`; the ordinary private journals remain in the configured log directory. No raw reasoning or local harness is included in the repository documentation. Automated validation after the fixes passes TypeScript and 239 tests, including real guard failure classification, falsely confident scripted convergence retaining unverified status, exact Unicode/full-transcript attachment bytes, incomplete-result attachments, context filtering that preserves stored files and unrelated content, and consistent incomplete output/fingerprints after a final-journal failure.

## Live fix regression — 2026-10-21

The actual installed `/debate` command ran through OpenChamber in parent `ses_e9f00ce86ffe1g4YP1l4ZfVDzw`, using GLM as Proposer and DeepSeek as Challenger, both low/free, `min_rounds: 2`, `max_rounds: 3`, and `include_transcript: true`. The complete promise fixture and disputed review claim were supplied; the independently executed expected output was not supplied to the models. Journal: `2026-10-22T00:25:03.680Z-what-exact-promise-states-and-event-order-does-this-code-produce-eed0486c.json` (UTC filename; still October 21 locally).

The engine completed P0/C1/P1/C2/P2/C3 in 268.933 seconds with no retries or schema repairs. P0 repeated the wrong rejected-state claim; C1 correctly rejected it. Later reviews resolved four objections and retained C5: the latest answer still reversed two internal jobs even though it predicted the observable events correctly. The engine ended `max_rounds`, with C5 open, `Current answer (not converged)`, and `verification: "not_independently_verified"`. It did not relabel this as agreement or silently repair the model's text. Independent Node.js 24.5.0 checks confirmed the pending state, the additional pending snapshot after one microtask, and the synchronous-throw boundary case.

The original attachment `debate-result-fa66c61dfbea.md` contains all six raw turn replies and is exactly 31,285 UTF-8 bytes. Its SHA-256 is `fa66c61dfbea5f5d23283dd7e5a12b0e109b576cdc491257e14bad67ada13585`, matching both the final journal's fingerprint and its complete `finalResult` string. Native Code Mode retained the file independently of the caller's prose; OpenChamber displayed a clickable attachment in the expanded **Script search, debate** card. The calling model kept the verification/status/unresolved point, referred to the original file, and finished with no Markdown-media/provider error. The parent and both children were idle afterward and reported zero cost. Evidence and the assertion harness are retained privately under ignored `.test-runtime/issue-fix/`.

A preliminary run was interrupted before changing the provider-context filter; that parent and both children were verified idle. No unrelated sessions were interrupted. Subsequent local checks also cover early logging/final-checkpoint failures so even those returned originals remain labeled incomplete/unverified. The prompt improvements reduced false agreement in this fixture; model reasoning errors remain possible and are not claimed eliminated.

## Five maximum-round logic tests — 2026-10-21

After deploying and pushing `d72cbfd`, the actual installed command ran five new logic questions concurrently with `min_rounds: 8`, `max_rounds: 8`, full transcripts, and low/free participants. All five completed eight rounds and returned converged: 80 validated replies, 86 adapter attempts, four recovered timeouts, and two role/status repairs. All native original attachments matched their journals (57,447–168,754 UTF-8 bytes), all parents/children finished idle with zero cost, and no provider/media error occurred in the callers.

Convergence again did not establish correctness: both models retained a false async-iterator value-unwrapping claim after eight rounds. The final ABA/parser code passed independent executable checks; SQL repairs passed 2,560 query checks across 512 key subsets; the graph method was compared against 19,683 exhaustive small graphs. Native child histories revealed 88 forbidden reads, all denied, including a 63-attempt iterator turn loop stopped by a call timeout. Complete recorded reasoning blocks were not found in opposing logged prompts. The [full report](LOGIC_STRESS.md) records exact cases, sessions, evidence, and the remaining model/runtime limitations.

A separate direct-core timer overflow found during this audit was reproduced and fixed after the callers were idle. Configuration was already protected; the core now rejects out-of-range/fractional values before dispatch and avoids arming invalid total timers. The before/after regression and full suite pass: TypeScript plus 240 tests. Raw questions, reasoning, model histories, and the local test controller remain private under ignored `.test-runtime/logic-stress/`.

## Ten-risk fault audit — 2026-10-22

The [ranked audit](FAILURE_AUDIT.md) adds 19 tests covering false consensus, injection/roles/IDs, forbidden-tool loops, JSON recovery, Unicode, cancellation races, retry classification, observers, journal faults, and config inheritance. Six of the initial 16 tests passed and ten failed on unchanged baseline `89e322c`; all failing regressions were in place before their fixes. After the fixes and three compatibility/isolation checks, TypeScript and all 259 tests pass.

The native-loop fixture exercises the production execution hook and adapter through a fake SDK: three forbidden calls produce a scoped interrupt and a permanent protocol failure. It does not assert observed remote-provider cancellation. The running OpenCode host was reloaded through the OpenChamber proxy with no active sessions; the linked local plugin reports active and its hidden debater agent is present. That smoke check submitted no prompt and performed no inference. The earlier wrong live iterator answer remains unresolved model-quality evidence, and every result stays unverified.

## Independent execution checks — 2026-10-22

The optional [trusted verifier](VERIFICATION.md) now supplies runtime evidence and blocks agreement when the current answer fails or lacks a conclusive check. The [live report](VERIFICATION_LIVE.md) preserves an initial five-case batch's failures and the subsequent full rerun on `c291e57`. All five rerun debates completed eight rounds: 80 validated replies, 40 checker records, and final passing JSON predictions in every case. The formerly wrong async-iterator prediction corrected after the checker supplied the observed trace; a numeric/string sort prediction also corrected after a failed comparison.

Original Markdown attachments of 34,323–55,077 bytes matched their journals and fingerprints; all callers and ten children finished idle with zero cost and no caller provider/media error. An additional independent checker execution accepted each final prediction. Four out-of-scope reads in separate native calls were denied. These checks cover fixed-program JSON output, not arbitrary explanation claims or generated source. A parser false positive in the one repaired reply was reproduced and fixed after the live sessions became idle. TypeScript and all 281 tests pass; recorded raw histories/evidence remain private and ignored.
