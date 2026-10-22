# Five debates with independent execution checks

Tested October 22, 2026 (America/New_York), through the running OpenChamber proxy and OpenCode 2.0.32. The optional verifier was implemented and pushed as `7259997`; the live-test feedback/label fixes were pushed as `c291e57`. The installed links point to this repository. Each actual `/debate` invocation used GLM 5.3 Flash Free and DeepSeek V4.1 Flash Free, low variants, `min_rounds: 8`, `max_rounds: 8`, and full transcripts. The checker ran fixed trusted Node.js 24.5.0 fixtures and compared JSON predictions; model-generated source was never executed.

## Final five-case batch

After retaining the initial batch's failures and fixing the feedback issues below, all five cases were rerun on `c291e57`. Each completed eight rounds and 16 validated replies, with its final prediction passing independent execution. That is **80 validated replies and 40 checker records**: 38 passes, one failed prediction, and one inconclusive format. There were 39 completed candidate comparisons; the inconclusive case still received the fixture's runtime observations. Every revised proposal was checked separately.

| Case | Result | Checker history P0…P7 | Duration | Original Markdown bytes |
| --- | --- | --- | ---: | ---: |
| Genuine async iterator vs sync wrapper; body/close error precedence | converged, 8 rounds | inconclusive, then 7 passes | 165.518 s | 55,077 |
| Promise `finally`, returned thenable, and reaction ordering | converged, 8 rounds | 8 passes | 120.768 s | 38,642 |
| Proxy get/set/delete invariants and trap side effects | converged, 8 rounds | 8 passes | 84.230 s | 40,483 |
| Live Map iteration, deletion/reinsertion, exhausted iterator, SameValueZero | converged, 8 rounds | 8 passes | 170.245 s | 35,449 |
| Sparse arrays, BigInt/Number equality, nullish operators, numeric element types | converged, 8 rounds | failed, then 7 passes | 91.627 s | 34,323 |

All parents and ten children finished idle with zero reported provider cost and no caller provider/media errors. No provider or timeout retries were needed. One valid final reply was unnecessarily repaired because of the parser bug described below; its corrected attempt passed. Native histories show four out-of-scope `read` attempts in the coercion case, each in a different native call and each denied before execution. No debater file contents were returned.

Each stored Markdown attachment matched its journal's final text, UTF-8 byte count, and SHA-256. Every final check's answer hash matched the current answer. An additional independent run of the checker outside the debate engine accepted all five final predictions and confirmed fixture hashes. The canonical output displays check status/scope while retaining the whole-answer unverified notice.

## What the evidence corrected

**Iterator:** the earlier agreement-only stress test had accepted a false claim that genuine async iterators always unwrap promise-valued elements. In this final batch, the P0 answer omitted a usable embedded prediction, so the checker returned inconclusive while supplying its actual trace. P1 then correctly predicted `body-promise:true` for both genuine async-iterator variants and `false` for the sync-iterator wrapper. A body throw survives the closing error; a break exit propagates the closing error. P1 through P7 all passed.

**Coercion:** the opening JSON predicted string elements `["100","20","3"]` after default sorting. Execution produced numeric elements `[100,20,3]`: sorting compares string keys but preserves the original elements. The checker failed P0, the Challenger objected using the observed output, and the revised answer passed. The explanation also corrected its ULP claim; that prose correction was reviewed by the models rather than verified by the prediction comparison.

The checker verifies the JSON prediction only. It does not establish that every sentence in those explanations is correct or that arbitrary replacement code works. Eight rounds were required in these runs, so unit tests with a one-round minimum separately establish that even unanimous agreement cannot bypass failed/inconclusive checks.

## Initial failures were preserved

The first five-case batch on `7259997` produced three converged cases, an iterator `max_rounds` result with failed checks, and a Map protocol error. These are retained failures, not counted as successful final runs.

- The iterator used seven proposals without a usable canonical prediction, despite sometimes describing one in preceding prose. P7 finally supplied one, but still predicted the wrong Promise values. Independent execution contradicted it, C8 opened substantive objections, and the run ended `max_rounds`, not converged. The final batch received runtime observations from P0 and corrected the mistake at P1.
- The Map Challenger returned the string `"null"`, then copied the descriptive answer placeholder on repair. Strict validation stopped after the bounded repair. Challenger templates now demonstrate actual JSON `null`; verifier feedback preserves the role and directs prediction-format requests only to the Proposer. The rerun completed without role repair.
- Feedback originally provided no runtime trace if the prediction format was missing. The checker now supplies observations for repair while keeping that verdict inconclusive and recording zero candidate comparisons. Guidance explicitly requires machine-readable data inside the final `answer` string.
- Failed proposals now display **Rejected answer (failed independent checks)**, with the failed status above the answer as well. This does not hide the rejected proposal or its evidence.

Four deterministic regressions for these feedback/format/label issues failed before their fixes. No malformed reply is silently normalized into agreement, and no model-reported test result is accepted as a verifier verdict.

## Parser follow-up after the live runs

Inspecting the final coercion case's repaired P1 found a separate parser false positive. The model put a malformed prediction example in a **closed** code fence, followed by a valid final debate JSON object. Prefix scanning treated the broken example as an unfinished real JSON wrapper and rejected the valid reply.

A regression reproduced this before the fix. Prefix scanning now excludes completed Markdown examples while retaining fence boundaries; an unfinished actual wrapper still fails closed. The exact previously rejected native reply now parses, and existing truncated-reply/wrapper protections continue passing. This parser correction was applied after all live sessions were idle; it was validated against the recorded reply and the full suite, not represented as another live-model run.

TypeScript and all **281 tests pass**, including 22 verification/follow-up regressions added since the earlier 259-test audit. The [configuration and checker contract](VERIFICATION.md) describe how to use the feature. It is optional: ordinary debates without a relevant trusted checker still have the original accuracy limitation.

## Retained evidence

| Case | Initial parent | Final-batch parent |
| --- | --- | --- |
| Iterator | `ses_e9b0d20b3ffeXehpeIdd0yLv59` | `ses_e9b041097ffeuWTRUWxqMmg85q` |
| Promise ordering | `ses_e9b0d1c46ffet6Ptnc33twCdwT` | `ses_e9b040a88ffeGZsSjc2OeN53Fi` |
| Proxy | `ses_e9b0d197dffe7lYru1nr56MIJI` | `ses_e9b04081effeag9sB6K3NvdIvV` |
| Map | `ses_e9b0d1720ffeZuzIesC0e1p9XA` | `ses_e9b04059bffenP8whfQVmIF3s2` |
| Coercion | `ses_e9b0d14c7ffej4zq5FgOd4ei33` | `ses_e9b040357ffe0CLCJ5oyUyOb7D` |

Private questions, contexts, raw replies/reasoning, native histories, journals, checker records, and controllers are retained under ignored `.test-runtime/verification-audit/2026-10-22/`; the final batch is in `retest/`. `before.txt`, `revision-before.txt`, `live-regressions-before.txt`, and `fenced-draft-before.txt` retain the failing regressions before their respective fixes. `check-final-deployed.txt`, `retest/verified.txt`, and `retest/independent-final-recheck.json` retain final validation. Only the reusable [fixtures](../test/fixtures/predictions), [checker](../scripts/verify-node-prediction.mjs), [tests](../test/verification.test.ts), and this summarized report are committed.
