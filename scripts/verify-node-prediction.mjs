#!/usr/bin/env node
// A trusted fixture prints one JSON value. Only that fixed file is executed;
// the proposed answer is parsed as data and never evaluated as source code.
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const send = (status, summary, checksRun = 0) => console.log(JSON.stringify({ status, summary, checksRun }));
let observation = '';
try {
  if (process.argv.length !== 3 || !path.isAbsolute(process.argv[2])) throw Error('Configure one absolute trusted Node fixture path');
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 4_000_000) throw Error('Input exceeds checker limit');
  }
  const input = JSON.parse(raw);
  const fixtureSha256 = createHash('sha256').update(await readFile(process.argv[2])).digest('hex');
  const { stdout } = await promisify(execFile)(process.execPath, [process.argv[2]], { timeout: 5000, maxBuffer: 32_768, encoding: 'utf8' });
  const actual = JSON.parse(stdout);
  observation = `Independent Node ${process.versions.node} execution. Fixture SHA-256: ${fixtureSha256}. Observed JSON: ${JSON.stringify(actual)}`.slice(0, 8000);
  const blocks = [...input.answer.matchAll(/^```json[^\S\n]*\r?\n([\s\S]*?)^```[^\S\n]*$/gmi)];
  if (blocks.length !== 1) {
    send('inconclusive', `The Proposer must place exactly one fenced json object {"prediction": <the printed JSON value>} INSIDE the answer string of the final debate JSON, not only in preceding prose. No candidate comparison ran. ${observation}`);
  } else {
    const candidate = JSON.parse(blocks[0][1]);
    if (!candidate || Array.isArray(candidate) || typeof candidate !== 'object' || Object.keys(candidate).length !== 1 || !Object.hasOwn(candidate, 'prediction')) throw Error('Prediction block must contain exactly the prediction field');
    const passed = isDeepStrictEqual(candidate.prediction, actual);
    send(passed ? 'passed' : 'failed', `${passed ? 'Exact prediction matches.' : 'Prediction contradicted.'} ${observation}`, 1);
  }
} catch {
  send('inconclusive', `Checker could not parse the prediction or execute the configured fixture. No candidate comparison completed. ${observation}`);
}
