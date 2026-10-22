# Independent checks for debate answers

Model agreement cannot establish correctness. The tool can now require an independent executable check of each proposed answer before agreement can stop a debate. This addresses false consensus for claims covered by a reliable checker. Arbitrary factual questions still need an independent source of truth; adding more models or rounds does not supply one.

## Configure a trusted checker

Add `verifier` to a project's `.opencode/debate.config.json`. The command comes from local configuration, never from a model reply or tool argument. It runs automatically after every validated Proposer answer, before the Challenger reviews it. Both sides receive its evidence. Failed or inconclusive checks block both convergence and early stalemate; the debate continues within its round/deadline budget. If the last answer still fails, the result is `max_rounds` with the failed check displayed. Checker execution/protocol errors stop with a partial error result.

This example checks the exact JSON output prediction of a fixed, trusted Node program:

```json
{
  "verifier": {
    "command": [
      "/absolute/path/to/node",
      "/absolute/path/to/opencode-debate/scripts/verify-node-prediction.mjs",
      "/absolute/path/to/trusted-fixture.mjs"
    ],
    "scope": "Exact JSON output prediction of the supplied fixture on Node 24; explanation is outside scope",
    "timeoutMs": 10000
  }
}
```

Replace those paths with actual absolute paths. The fixture must print exactly one JSON value. Supply its complete source as debate context, and ask the Proposer to include exactly one fenced `json` block INSIDE the `answer` string of its final debate JSON, containing `{"prediction": <the printed JSON value>}`. Predictions only in preceding free-form prose are not part of that answer. Array order matters; object key order does not. The supplied checker executes only the configured fixture and parses the proposed prediction as data. It never executes source from the answer. The [five example fixtures](../test/fixtures/predictions) cover async iterators, Promise cleanup ordering, Proxy invariants, Map mutation, and numeric/sparse-array behavior.

If the prediction cannot be parsed, the checker still supplies observed runtime output for repair, but returns `inconclusive` with zero completed candidate comparisons. Its feedback is role-specific: only the Proposer supplies an answer/prediction; the Challenger keeps `answer: null` and puts objections in point notes. Challenger JSON examples use actual null, never a descriptive string placeholder.

Keep this checker scoped to its fixture. A passing output prediction does not verify the answer's explanation, replacement code, arbitrary programs, or unrelated questions. The command is a trusted local program with the host user's privileges; the plugin does not sandbox it. Debater tools and file permissions remain restricted. For generated-code testing, configure a checker that provides its own isolation and independently maintained tests rather than evaluating answers in the plugin process.

Remove `verifier` to restore agreement-only behavior. There is no built-in default ground truth for every question, and no tool argument can disable or replace a configured checker. Existing setup preserves this configuration.

## Checker contract

The plugin launches the executable directly with its configured argument array, without a shell, using the active project directory. JSON on stdin contains `question`, optional `context`, and the exact `answer` string. The executable returns exit code zero and exactly one JSON verdict on stdout:

```json
{
  "status": "failed",
  "summary": "Observed body receives a Promise; the proposed prediction says otherwise.",
  "checksRun": 1
}
```

`status` is `passed`, `failed`, or `inconclusive`. A pass requires at least one executed check. The summary must be nonempty, well-formed Unicode, at most 10,000 characters; extra fields are rejected. `checksRun` is an integer from 0 to 1,000,000. Stdout and stderr together are limited to 64 KiB. Nonzero exits, malformed verdicts, output overflow, launch failures, and checker deadlines fail closed. Verifier timeouts default to 10 seconds and share the debate's total deadline/cancellation; active child processes are killed on abort (with process-group cleanup on POSIX). Windows process-tree termination beyond the direct child is unverified. Only PATH, LANG, and TZ are inherited; provider keys and Node preload environment settings are not forwarded.

A checker is part of the trusted test infrastructure. It must determine coverage and results independently; it must not accept a model's claimed test result as evidence. Its configured scope is shown in the output. The supplied Node checker records the runtime version, trusted fixture SHA-256, and observed JSON in its summary.

## Results and limits

Each check is recorded as `independentChecks[]`, with the proposal turn, configured scope, verdict, executed count, summary, start/end times, and SHA-256 of the exact answer tested. A prior pass never carries over to a revision. Checker evidence is checkpointed privately, relayed to both sides, and included in the canonical Markdown/attachment. Stop checks record the current verdict. A passing check does not force the Challenger to agree or resolve an open objection.

The existing whole-answer `verification: "not_independently_verified"` marker remains: finite scoped checks do not prove every claim. A converged answer whose configured checks passed is headed **Agreed answer (independent checks passed)** and lists their scope. A completed proposal that fails is headed **Rejected answer (failed independent checks)**, with the verdict above the answer too. An inconclusive proposal is labeled accordingly. Agreement without a configured checker remains explicitly unverified.

The implementation has 21 new regressions covering false consensus, correction, zero-test/inconclusive results, stale passes, deadlines/cancellation, checkpointing, revised point preservation, subprocess failure/output limits, argument/data separation, credential isolation, actual process termination, the supplied executable prediction checker, role-specific feedback, canonical-answer data placement, and rejected-result labeling. Five initial regressions failed before implementation; a further partial-state regression and four live-test follow-up regressions were reproduced before their fixes. TypeScript and all 280 tests pass. These deterministic tests establish control and transport behavior; live model results are recorded separately.
