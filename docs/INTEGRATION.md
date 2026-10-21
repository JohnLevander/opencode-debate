# Phase 3 integration results

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

Automated isolation remains separate: `npm run check` passes TypeScript and 40 core/adapter/plugin/config/log tests, including scripted convergence, revisions, stalemate, maximum rounds, parser repair, rate limits, timeout/cancellation, ignored SDK signals, and late admission/results. An isolated OpenCode server also verified plugin/agent/command registration before global installation.

## Changes prompted by live testing

- Accept the server's normalized `variant: "default"` when configuration omits a variant; retain validation for actual model/variant changes. Added a regression test.
- Preserve OpenCode's assembled system context while clearing debater tools; the agent still uses the specified system prompt. Preserving that context did not resolve FreeTierError.
- Write per-child interrupt request times, acknowledgment times, returned `interrupted` flags, and acknowledgment errors to final logs. Both timeout/cancellation tests check these records.

Phase 3 is reported with blocked provider acceptance. Approval is required before implementing Phase 4's OpenAI-compatible adapter and mock-server tests. That work would add a selectable backend; it would not itself authorize live paid inference.


## User reproduction — 2026-10-20, 8:06 PM America/New_York

The user's later free-only run reproduced the failure on OpenCode 2.0.32. Log `2026-10-21T00:06:31.445Z-what-is-the-best-microphone-under-50-for-vocal-singing-live-04981d33.json` records DeepSeek as Proposer, GLM as Challenger, zero Challenger rounds, and provider.auth during P0 after 250 ms. Both child interrupt requests were acknowledged as already idle. This is additional evidence of the same rejection, not a successful debate. No paid key/provider is implied by this error alone.

The adapter now appends a specific explanation to this recognizable free-tier error: the request already used an OpenCode child, tool-disabled requests have a reported compatibility issue, and changing tool permissions requires approval. Unrelated authentication errors retain their original diagnosis. Two regression tests cover that distinction. The default remains the user's explicitly selected free OpenCode backend; no permissions were relaxed, no global settings were changed in this diagnostic patch, and no paid inference was performed.
