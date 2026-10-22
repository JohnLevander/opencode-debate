# Five maximum-round logic debates

Tested October 21, 2026 (America/New_York), using deployment commit `d72cbfd`, OpenCode 2.0.32, and the running OpenChamber front end. The installed plugin and command point to this repository. The five actual `/debate` calls ran concurrently with the original free models, low variants, `min_rounds: 8`, `max_rounds: 8`, and `include_transcript: true`. Eight is the supported maximum. Calls had 180-second deadlines and each debate had a 30-minute total deadline. Independent expected results were withheld from the models.

## Results

All five engines reported **converged** after P0/C1/P1/…/P7/C8: 80 validated replies across 40 Challenger rounds. That status records agreement, not correctness. All parent and child sessions finished idle, reported zero cost, and retained the original model selections. Four call timeouts recovered within the existing single-timeout budgets; SQL needed two bounded role/status repairs. There were 86 adapter attempts in total; a native attempt can include additional model steps and tool attempts.

| Case | Engine duration | Adapter attempts | Original Markdown bytes | Independent assessment |
| --- | ---: | ---: | ---: | --- |
| Async iterator value/closure semantics | 565.990 s | 17 | 57,447 | **False consensus:** A/B still have the wrong promise-valued body prediction. |
| Version-token ABA and numeric exhaustion | 336.502 s | 16 | 78,829 | Final BigInt patch passed 16,384 operation schedules and large-epoch checks. |
| SQL NULL composite anti-joins and duplicates | 743.212 s | 19 | 85,075 | Initial row sets and several explanations were wrong; final query repairs passed independent SQLite checks. |
| Zero-weight cycles and shortest-walk counts | 499.617 s | 17 | 147,139 | Main algorithm and example outputs agree with independent exhaustive checks; one numeric explanation overstates rounding. |
| Parser precedence, associativity, and rounding | 985.451 s | 17 | 168,754 | Several incorrect revisions were challenged. Final parser passed its supplied suite, 3,000 generated expressions, and invalid-input checks. |

Every native Markdown attachment matched its journal's `finalResult`, SHA-256, and UTF-8 byte count, with all 16 raw replies retained. All parent callers finished without provider/media errors. OpenChamber displayed the eight-round result and unverified notice. Calling-model prose can still reformat results; the original attachments remain authoritative for exact wording.

## Bugs and remaining limitations

### Direct core timer overflow — fixed

The exported `runDebate` entry point accepted a timeout larger than Node's signed 32-bit timer maximum. A direct call with `totalTimeoutMs: 2147483648` dispatched a callback, emitted `TimeoutOverflowWarning`, and failed after about 7 ms: Node replaced the requested timeout with 1 ms. The ordinary plugin configuration already rejected this input, so configured tool calls were protected.

The core now requires both timeouts to be integers from 1 through 2,147,483,647 and does not arm an invalid total timer. The new regression failed before the fix. Afterward the same reproduction returns a protocol error with zero dispatched calls and zero warnings. Fractional/infinite timeouts are also rejected; the inclusive maximum remains valid. TypeScript and all **240 tests pass**. This fix was applied after the five live callers became idle; their results describe the deployed pre-fix commit above.

### Wrong iterator answer survives eight rounds — unresolved model-quality failure

Both models accepted the claim that a genuine async iterator's yielded promise is always unwrapped. The final answer predicts `body-promise:false` for variants A and B. Node.js 24.5.0 executes the supplied fixture with `body-promise:true`: awaiting the iterator result does not unwrap its `value` field for a genuine async iterator. The async-from-sync adapter in variant C does unwrap that field.

A minimal independent check is:

```js
const iterator = {
  [Symbol.asyncIterator]() { return this; },
  async next() { return { value: Promise.resolve(7), done: false }; },
  async return() { return { done: true }; }
};
for await (const value of iterator) {
  console.log(value instanceof Promise); // true on the tested Node 24.5.0
  break;
}
```

The models correctly resolved separate closure/exhaustion/continue errors but left this central error unchallenged. They correctly predicted the original body error winning over a closing error on throw, and the closing error winning on break. Eight rounds and high confidence did not establish correctness. The deterministic `not_independently_verified` notice remained present; no automatic code-execution verification is claimed.

### Repeated forbidden reads waste runtime — bounded, not eliminated

Native child histories show **88 attempted reads, all denied before execution**: 82 in the iterator case, one in SQL, and five in the parser case. No file contents were returned. Of the iterator case's 82 denials, 63 occurred during one GLM turn before its 180-second deadline; the timeout interrupted that turn, and the retry subsequently completed. The other 19 denials occurred in other turns. The other cases had no successful debater tools either.

This is a model tool-use/runtime limitation of advertising native read for free-tier compatibility. The guard held, but its denial does not itself stop repeated attempts. The call/total deadlines bound the loop; this change does not add a new denial-count policy or relax permissions. Individual tool attempts remain in native child histories, while the debate journal records logical attempts, final replies, and timeout/repair events. Do not interpret the journal's turn count as the number of native model/tool steps.

### Smaller factual and protocol errors

The graph answer correctly requires BigInt counts, but says the `2^60` example itself would silently round. That exact power of two is representable as a Number; nearby counts such as `2^60 + 1` can lose precision. The main counting algorithm remains appropriate for the required exact-count contract.

The SQL run first misread nullable IDs as key values and returned wrong sets. Later reviews corrected these errors and the false assertion that nullable declared join columns cannot serve as sentinels. SQL Proposer replies twice used Challenger-only point statuses; the existing single-repair path recovered each time. The parser run initially gave wrong traces, rejected valid `+2`, and repeatedly mischaracterized rounding near `2^53`; its Challenger corrected those before convergence. These observations do not justify loosening protocol validation or claiming general model accuracy.

## Independent validation

- **Iterator:** exact Node executions of body-throw, break, and sync-iterator variants, including event order and caught errors. Expected A/B bodies receive Promises; C receives the number.
- **ABA:** the reset counterexample and stalled Number increment at `2^53`; 16,384 seven-operation schedules against an independent identity-token implementation and the final model's actual BigInt code. Rejected commits preserve state; resets and successful commits invalidate old tickets.
- **SQL:** SQLite 3.45.3 returns Q1 `[6]`, Q2 `[1,2,3,4,5,6,7]`, Q3 `[2,3,4,5,6,7]`. Added duplicate matches expose Q2's multiplicity error. Across 512 B-key subsets, nine nullable A-key pairs, and duplicate/nullable-ID B rows, 2,560 query executions confirm NOT EXISTS, the guarded NOT IN repair, and valid left-join sentinels agree. `B.x` and `B.y` are non-null on any TRUE ordinary-equality match even though their declared columns allow NULL.
- **Graphs:** all 19,683 directed three-vertex graphs with absent/zero/one-weight edges, including self-loops, checked against independent bounded walk-count DP; 11,982 infinite-count cases. Additional source=target, parallel-edge, off-corridor cycle, and `2^80` exact-count checks. The final model's algorithm was compared with this method; no claim is made that its pseudocode was executed verbatim.
- **Parser:** independent grammar evaluator, separate execution of the original sketch at ordinary and enormous precedence values, boundary arithmetic checks, and the final model's actual parser/test code. The parser passed all ten requested values, 11 additional invalid inputs, 3,000 generated arithmetic AST cases, and its own supplied suite. This is finite test coverage, not a proof for every input.
- **Transport/lifecycle:** original model/agent selection, maximum-round gating, no early agreement stop, bounded retries/repairs, exact attachments, zero cost, idle parents/children, and no complete recorded reasoning blocks found in opponents' logged prompts. No isolation bypass or deadlock was observed.

## Retained evidence

| Case | OpenChamber parent session | Private journal suffix |
| --- | --- | --- |
| Iterator | `ses_e9eecc7eeffe7bhzF7LwXmlWuU` | `cde59ba7` |
| ABA | `ses_e9eecc503ffeRMzwAh80sBb2Hz` | `7a7da955` |
| SQL | `ses_e9eecc42dffeKBuUoSVvYDhkn3` | `e8ce9758` |
| Graph | `ses_e9eecc28affeTtRIfoS5GEt7nt` | `2a41b60b` |
| Parser | `ses_e9eecc15effelxyt3MaOe2DzPb` | `1f669752` |

Journals use the configured private log directory. Full prompts, exact attachments, histories, independent executable checks, before/after timer reproductions, and assertion results are retained under ignored `.test-runtime/logic-stress/`. Raw reasoning and local runtime/configuration data are excluded from the repository. The initial fixes were committed/pushed before these runs; the timer correction and this report are a follow-up deployment.
