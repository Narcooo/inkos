import {Worker} from 'node:worker_threads';
import {expect, it} from 'vitest';
import {matchesProtectedFragments} from '../harness/author-text-permission.js';

it('checks repeated protected separators without blocking cancellation', async () => {
  // Run the real matcher in an isolated worker so a backtracking regression
  // cannot block the test runner's deadline along with the production loop.
  const parts = ['Opening [.*]', ...Array<string>(32).fill('\n\n'), 'Protected ending'];
  const content = `Opening [.*]${'new dialogue\n\n'.repeat(64)}Changed ending`;
  const worker = new Worker(`
    const {parentPort, workerData} = require('node:worker_threads');
    const match = (${matchesProtectedFragments.toString()});
    parentPort.postMessage(match(workerData.content, workerData.parts));
  `, {eval:true, workerData:{content, parts}});
  try {
    const result = await new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Protected text check exceeded its deadline')), 2000);
      worker.once('message', result => {clearTimeout(timer); resolve(result);});
      worker.once('error', error => {clearTimeout(timer); reject(error);});
    });
    expect(result).toBe(false);
  } finally {
    await worker.terminate();
  }
});

it('preserves literal fragments in order without overlapping their boundaries', () => {
  const parts = ['[Opening]', '\n\n(beat).*\n\n', '[Ending]'];
  expect(matchesProtectedFragments('[Opening]new speech\n\n(beat).*\n\nmore speech[Ending]', parts)).toBe(true);
  expect(matchesProtectedFragments('[Opening]new speech\n\n(beat)X\n\nmore speech[Ending]', parts)).toBe(false);
  expect(matchesProtectedFragments('abc', ['ab', 'bc'])).toBe(false);
});
