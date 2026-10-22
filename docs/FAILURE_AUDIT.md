# Ten likely failure modes

Tested October 22, 2026 (America/New_York), against baseline `89e322c`. The risks were selected from the earlier live debates and the public core, parser, transport, callback, configuration, and journal boundaries. This audit uses scripted adversarial replies, mocked native hooks/SDK operations, local output encoding, and filesystem fault injection. It does not use new model inference or establish general answer accuracy.

Subsequent follow-up: optional [independent checks](VERIFICATION.md) now prevent failed or inconclusive externally checked answers from stopping by agreement. This historical audit still describes baseline agreement-only behavior and its 259-test milestone; general answer accuracy is not guaranteed.

The first **16 tests ran against unchanged production code: 6 passed and 10 failed**. The failing tests were added before implementation fixes. Three additional tests check parser compatibility, per-call denial isolation, and stalled/mutating observers. All **19 audit tests pass**, and `npm run check` passes TypeScript and **259 total tests**, with no skips.

## Ranked risks and results

| Rank | Likely failure | Test and baseline result | Current behavior |
| --- | --- | --- | --- |
| 1 | Confident agreement on a wrong answer | Scripted eight-round agreement on the previously disproved async-iterator claim, despite contradictory supplied observations. The verification-label test passed; the answer remains wrong. | Agreement always remains `not_independently_verified`. **Model-quality failure remains unresolved.** |
| 2 | Context injection, role switching, or invented point IDs | Context requests a paid backend/extra rounds; replies inject orchestration fields and an invented resolved C9. Passed. | Strict reply/role validation repairs once; model assignment, round bounds, and canonical point state remain unchanged. This does not prove resistance to every semantic prompt injection. |
| 3 | Repeated forbidden tools waste an entire deadline | Fake native prompt repeatedly invokes the actual execution guard. Failed: all 20 attempted reads were denied, but no denial-count interrupt occurred. | The third denial aborts that native call with a permanent protocol error and interrupts its child. Separate calls/participants have separate counters; two denials in each of three calls do not accumulate. |
| 4 | Prose, code fences, or broken drafts hide valid final JSON | Unfinished inline code braces and quoted draft examples preceded valid final JSON. Failed. A separate test rejecting every truncated prefix of a later reply passed. | Backward extraction recovers the final object while rejecting incomplete final replies and nested replies inside unfinished root objects. Prose punctuation and existing array-wrapper tolerance are preserved. |
| 5 | Large or malformed Unicode corrupts the exact result | A transcript larger than 1 MB with emoji, combining marks, and CJK text passed. Lone-surrogate semantic validation and raw-output encoding both failed. | Malformed answer/summary/note strings trigger bounded repair. Invalid code units in rejected text are visibly escaped in Markdown; raw JSON journal strings retain them. Canonical text, attachment bytes, and fingerprint agree without UTF-8 replacement. Valid Unicode is unchanged. |
| 6 | Cancellation races with late completion or rejection | Abort during a pending call, then reject that operation after the engine returns. Passed. | Cancellation wins, late failure is consumed, and no late answer is accepted. The existing suite also exercises call/total deadlines, late prompt admission, and retry barriers. |
| 7 | Misleading provider errors bypass retry budgets | Permanent HTTP 501 with rate-limit wording, plus permanent typed errors carrying legacy 429 fields. Both tests failed. | Concrete permanent HTTP statuses outrank envelope wording. Typed engine error codes outrank legacy retry fields. Genuine 429 and known transient outages retain bounded retries. |
| 8 | Observers change orchestration or crash the process | A start observer changed the Proposer, causing both roles to call DeepSeek. Async rejecting observers emitted seven unhandled rejections in an isolated child process. Both failed. | Observers receive copies; sync throws and async rejections are isolated. Hanging observers do not stall completion, and mutations of turn copies do not alter stored replies. |
| 9 | A failed initial journal write leaves a misleading log | Injected failure of the first checkpoint left an empty `.json` placeholder. Failed. Existing-journal collision preservation passed. | Initialization removes its own placeholder on failure where possible and never removes a pre-existing colliding journal. Persistent disk/process failures can still prevent cleanup or a final checkpoint. |
| 10 | Configuration inheritance fails at path boundaries | Project → `..branch` → nested directory lost its ancestor settings. Failed. | Directory traversal uses path-component boundaries, preserves project/ancestor/child precedence, and excludes siblings outside the project. |

## Fixed scope and remaining limits

Ten failing tests covered seven implementation areas: native forbidden-tool loops, JSON recovery, Unicode validation/output, retry classification, observer isolation, initial journal cleanup, and config inheritance. No permissions, provider selections, dependencies, or model-execution capabilities were expanded.

The denial budget counts execution-guard refusals during a native call; it does not count allowed reads of the empty file. Existing call/total deadlines still bound those reads. The regression invokes the production guard and adapter through a fake SDK, so it verifies deterministic cancellation wiring without asserting a new live-provider interrupt observation. A protocol failure preserves collected partial work; it is not silently converted into a timeout retry or agreement.

The false-consensus test deliberately demonstrates the accuracy boundary. It does not make the engine detect a false claim. The earlier [live iterator counterexample](LOGIC_STRESS.md#wrong-iterator-answer-survives-eight-rounds--unresolved-model-quality-failure) remains evidence that eight rounds and high confidence can still produce a wrong answer. The tool reports agreement and uncertainty; it cannot independently execute arbitrary answers or check facts.

The installed plugin/command symlinks still point to this repository. With no active sessions, the running OpenCode host was reloaded through OpenChamber's local proxy. The plugin registry reports `opencode-debate` active at the linked source path, with the hidden `debater` agent registered. This load smoke test made no model request; it does not establish live-provider cancellation or answer quality.

## Reproduce and inspect

```sh
node --import tsx --test test/failure-modes.test.ts
npm run check
```

The regressions are in [test/failure-modes.test.ts](../test/failure-modes.test.ts). Private local evidence is retained under ignored `.test-runtime/failure-audit/2026-10-22/`: `before.txt` (6/16 pass before fixes), `after-first-pass.txt` (16/16 pass), `parser-regression-before.txt` (additional compatibility regression before its fix), `full-final.txt` (259/259 plus TypeScript), and `native-registry.json` (active installed plugin). Historical live prompts, reasoning, and histories remain outside the repository.
