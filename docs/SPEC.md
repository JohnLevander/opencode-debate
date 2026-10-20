This file replaces the spec pasted into chat, which was cut off partway through the Architecture section. It incorporates docs/FINDINGS.md (commit 7dca46f). Where this spec and FINDINGS.md disagree about an OpenCode API detail, follow FINDINGS.md, since it reflects the installed OpenCode 2.0.32, and point out the conflict in your phase report.
When I explicitly ask for a debate, a debate tool randomly assigns GLM 5.3 Flash Free and DeepSeek V4.1 Flash Free to the roles of Proposer and Challenger. The two models alternate critique and revision, and the tool returns either a converged answer or a clear list of points they still disagree on. All loop control (randomness, round counting, convergence and stalemate detection, JSON parsing, retries, deadlines, logging) is deterministic TypeScript. No LLM orchestrates the loop.
- Commit after each phase with a descriptive message. Never commit secrets.
- Use the v2 plugin API (@opencode/plugin) exactly as documented in FINDINGS.md. No v1 patterns.
- Don't guess APIs. When uncertain, check the installed types or source, and say so.
- Before editing anything outside the repo (global config, global plugin/command/agent directories), show me the exact change and wait for approval.
- All prompt templates live in src/prompts.ts so I can tune them without touching logic.
- Pause points: (1) any change outside the repo; (2) after the Phase 3 live tests, report results and wait before starting Phase 4.
types.ts, parse.ts, and debate.ts. Engine signature, roughly:
ts
```ts
type Debater = "glm" | "deepseek";

function runDebate(opts: {
  question: string;
  context?: string;
  maxRounds: number;
  first: Debater | "random";
  callTimeoutMs: number;
  totalTimeoutMs: number;
  callModel: (
    debater: Debater,
    message: string,
    signal: AbortSignal,
  ) => Promise<{ text: string; reasoning?: string }>;
  onTurn?: (turn: Turn) => void;   // plugin uses this for progress and logging
  signal?: AbortSignal;            // overall cancellation
  random?: () => number;           // injectable for seeded tests; default crypto-backed
  now?: () => number;              // injectable clock for timeout tests
}): Promise<DebateResult>;
```
The engine owns all deadlines. For each call it creates an AbortController that fires on callTimeoutMs, on the total deadline, or on overall cancellation, and passes its signal to callModel. Each debater keeps its own conversation (the adapter handles history), so callModel sends only the new message for that debater.
parse.ts does tolerant JSON extraction (strip code fences, take the LAST JSON object in the text) and schema validation.
Implements callModel on the v2 plugin client.
- At debate start, check that both configured models are available, using the mechanism identified in FINDINGS.md. If one is missing (for example, the free promo ended), fail fast with an error naming the model and pointing to the fallback backend in the config.
- Create one child session per debater: parentID = the calling session, with that debater's model and the debater agent set at creation.
- To take a turn: send the message with session.prompt(), wait for completion using the mechanism from FINDINGS.md, then read the latest assistant message. Return its text parts (concatenated) as text and its reasoning parts as reasoning.
- The SDK's Promise adapter ignores request-option abort signals, so the adapter listens to the signal itself. On abort it calls session.interrupt() on that session, stops waiting, and rejects promptly with an error that says whether it was a timeout or a cancellation.
- Results that arrive after a call was aborted are discarded.
Fallback callModel using fetch against an OpenAI-compatible endpoint (default OpenRouter), keeping message history in memory per debater. Paid model IDs: z-ai/glm-5.3-flash and deepseek/deepseek-v4.1-flash. API key from env OPENROUTER_API_KEY.
Registers the debate tool through ctx.tool.transform. Wires config to the selected adapter, the execution context's abort signal to the engine, onTurn to progress reporting and logging, and the debater agent definition.
Loads debate.config.json from a location that follows v2 conventions (document it in the README), with env var overrides. Fields:
- backend: "opencode" or "openai-compatible"
- model IDs per debater (defaults: providerID opencode, modelIDs glm-5.3-flash-free and deepseek-v4.1-flash-free)
- defaultMaxRounds: 4
- callTimeoutMs: 300000
- totalTimeoutMs: 1800000
- logDir: default ~/.local/share/opencode-debate/debates
- optional reasoning variant per model, only if session creation supports one
A hidden agent named debater with ALL tools disabled (including debate itself, every built-in tool, and any MCP or plugin tools). Define it from the plugin if v2 allows that; otherwise propose the change to my global config and wait for approval. Agent prompt:
You are a debater in a structured two-model debate. You have no tools; reason from your own knowledge and the arguments in front of you. Be specific: give reasoning, evidence, or counterexamples, not vague doubts. The goal is the correct answer, not winning; change your position when shown a better argument, and hold it when you aren't. Write your reasoning in prose, then end every message with exactly one JSON object in the required format, with nothing after it.
Roles. Pick the Proposer (P) with crypto-backed randomness unless first is set. The other model is the Challenger (C). Record the assignment.
Sequence. P0 (opening answer), then rounds r = 1..maxRounds. Each round is C_r (critique) followed, if the debate continues, by P_r (response and revision). Stop conditions are checked after every C turn, so the debate always ends on a Challenger turn and the list of unresolved points is always current.
Turn templates (in src/prompts.ts):
P0, sent to P:
QUESTION: {question} {context, if any} You are the PROPOSER. Give your best answer with explicit reasoning. Another model will look hard for flaws in it.
C1, sent to C (includes the question, the context, and P0's text):
You are the CHALLENGER. Assume the answer below contains at least one substantive flaw and look hard for it: factual errors, faulty reasoning, missing cases, overconfidence, or a better alternative answer. List each objection as a point with ID C1, C2, ... and a specific argument, evidence, or counterexample. Explicitly concede the parts you checked and found correct. Do not invent objections or nitpick wording. If after real effort you find no substantive flaw, say so and set agrees_with_current_answer to true.
P_r, sent to P (includes C's latest text):
For every point with status "open", either concede it (status "conceded") and fix your answer, or defend it (status "defended") with specific reasoning. Do not defend a point just to avoid conceding, and do not concede one you can show is wrong. Then give your full revised answer in the "answer" field.
C_r for r >= 2, sent to C (includes P's latest text):
For each of your points: if it was conceded, check that the revision actually fixes it (status "resolved") or keep it "open" and explain what's still wrong. If it was defended, either accept the defense (status "withdrawn") or keep it "open" with a specific reply, not a restatement. Add new points, using the next unused ID, only for genuinely new issues that the revision introduced or revealed. Same standard as before: look hard, but don't invent objections.
Every template ends with a reminder of the required JSON format:
json
```json
{
  "answer": "string or null (P: full current answer. C: the answer C would endorse, or null)",
  "points": [
    { "id": "C1", "summary": "...", "status": "open|conceded|defended|resolved|withdrawn", "note": "..." }
  ],
  "agrees_with_current_answer": true,
  "confidence": 0.0
}
```
Relay only the final text parts to the opponent; never relay reasoning parts. Store the reasoning in the log when it's available.
Point state. The engine keeps a canonical map of points. C is authoritative for open/resolved/withdrawn, and P is authoritative for conceded/defended. If a P turn fails to address an open point, re-prompt once and list the missing IDs. Ignore any point ID from P that C never raised.
Stop conditions (checked after each C turn):
- converged: C sets agrees_with_current_answer = true AND no points are open.
- stalemate: from C_2 onward, the set of open point IDs is identical to the previous C turn's.
- max_rounds: C_maxRounds is reached without either of the above.
- cancelled: I cancelled the tool call.
- error: unrecoverable failure, including the total deadline (record the reason).
Final answer = P's latest "answer" (P0's answer if the debate converged at C1).
- Call timeout: when the per-call deadline fires, retry once in the same session, sending the original message prefixed with "Your previous reply was interrupted before it finished. Reply again in full." A second failure ends the debate with status error and returns everything gathered so far.
- Unparseable JSON: re-prompt once with "Reply with ONLY the JSON object in the required format." A second failure counts as a call failure.
- Rate limits (HTTP 429 or the provider's equivalent error): exponential backoff, honoring Retry-After where it's available, up to 3 attempts.
- Cancellation: when the tool's execution abort signal fires, abort the engine, which interrupts both child sessions, and return a partial result with status cancelled.
- Always write the log file, including on error or cancellation.
- Two child sessions per debate (parentID = the calling session), titled "debate: <slug> | GLM (proposer)" and "debate: <slug> | DeepSeek (challenger)", with the roles filled in to match the actual assignment.
- Don't delete them afterward; I want to be able to inspect them.
Report through the execution context's progress mechanism at debate start, before each turn, and at the end. Example: "Round 2/4: DeepSeek (challenger) reviewing the revision."
Args (Zod, per v2 conventions):
- question: string (required)
- context: string (optional; background material for both debaters)
- max_rounds: number (optional, 1 to 8, default from config)
- first: "glm", "deepseek", or "random" (optional, default "random")
- include_transcript: boolean (optional, default false)
Description (verbatim):
Run a structured debate between two models (GLM 5.3 Flash and DeepSeek V4.1 Flash) on a question, returning their converged answer or the specific points they still disagree on. Call ONLY when the user explicitly asks for a debate (e.g. "debate this", "use debate", /debate). Never call it on your own initiative. When it returns, present the result as given: the final answer first, then any unresolved points with both sides' positions. Do not add your own verdict on unresolved points or re-argue them unless the user asks.
Return value: a markdown string.
```
## Debate result: <converged | stalemate | max_rounds | cancelled | error>
Proposer: <model> | Challenger: <model> | Rounds: <n>
### Final answer
<final answer>
### Unresolved points        (omit if none)
- C2: <summary>. Challenger: <latest position>. Proposer: <latest position>.
### Details
Log: <path to JSON log>. Sessions: <titles/IDs>.
```
If include_transcript is true, append every turn, labeled with model, role, and turn ID.
JSON log at <logDir>/<ISO timestamp>-<slug>.json. Contents: question, context, config, role assignment, every turn (raw text, parsed JSON, reasoning if available, timings, retries), point-state history, status with reason, and the final result.
A global custom command named debate, using the v2 directory and format:
- description: Run a two-model debate on a question
- body: "Use the debate tool on this question: $ARGUMENTS. Present the result exactly as the tool description instructs."
Phase 1: core. Engine, parser, prompts, and types, with unit tests using a scripted fake callModel and the injectable clock and random source. Cover:
- converged at C1
- converged after revisions
- stalemate
- max_rounds
- malformed JSON that recovers on retry
- malformed JSON twice (error)
- a call timeout followed by a successful retry, including that the retry message carries the interruption prefix
- two timeouts (error)
- total deadline exceeded
- a late result arriving after abort is discarded
- P omitting a point
- P inventing an unknown point ID
- cancellation mid-debate (status cancelled, partial result)
- role randomization: both assignments occur across seeded runs, and first is respected
Phase 2: v2 plugin. OpenCode adapter, model availability check, child sessions, hidden debater agent, progress, cancellation via session.interrupt(), logging, tool registration, and the /debate command. Unit-test the adapter against a mocked client where feasible. Add scripts/install.sh, which links the plugin and command into the correct v2 global locations (with my approval) so repo edits take effect after an OpenCode restart.
Phase 3: integration. Test in isolation first, then live through OpenChamber:
- a) A question with a clear answer: "In IEEE 754 double precision, does 0.1 + 0.2 exactly equal 0.3? Explain." Expect convergence within 1-2 rounds.
- b) A genuinely contested question of your choosing. Expect several rounds; report the status and point history.
- c) Error path: set callTimeoutMs to 1000 and confirm a clean error result plus a log file.
- d) Cancellation: start a debate, cancel it from OpenChamber, and confirm both child sessions were interrupted and a cancelled log was written.
Also confirm that the calling session isn't deadlocked while the debate runs, and report whether the child sessions appear nested in OpenChamber. Write the README: what it does, install/uninstall, config options, switching to the fallback, reading the logs, where to tune the prompts, and known limitations (the free models are limited-time and only work inside OpenCode; the free GLM can be slow; two models agreeing doesn't prove they're right). STOP and report.
Phase 4: fallback adapter. The openai-compatible adapter, selectable in config, tested against a mock server, with the README updated.