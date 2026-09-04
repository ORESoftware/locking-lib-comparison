import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArguments } from '../bin/benchmark.mjs';
import { runBenchmark } from '../src/benchmark.mjs';

test('benchmark reports complete acquire/release cycles and latency percentiles', async () => {
  const held = new Set();
  const adapter = {
    name: 'test-adapter',
    async acquire(key) {
      assert.equal(held.has(key), false, `unexpected key contention for ${key}`);
      held.add(key);
      await delay(1);
      return { key };
    },
    async release({ key }) {
      assert.equal(held.delete(key), true);
      await delay(1);
    },
  };

  const result = await runBenchmark({
    adapter,
    targetName: 'test',
    durationMs: 40,
    warmupMs: 10,
    concurrency: 4,
    keys: 8,
  });

  assert.equal(result.target, 'test');
  assert.equal(result.errors, 0);
  assert.ok(result.cycles > 0);
  assert.equal(result.samples, result.cycles);
  assert.ok(result.opsPerSecond > 0);
  assert.ok(result.latencyMs.p95 >= result.latencyMs.p50);
  assert.ok(result.latencyMs.p99 >= result.latencyMs.p95);
  assert.equal(held.size, 0);
});

test('benchmark records bounded error examples without aborting the window', async () => {
  const adapter = {
    name: 'broken',
    async acquire() {
      throw new Error('cannot acquire');
    },
    async release() {
      throw new Error('should not run');
    },
  };

  const result = await runBenchmark({
    adapter,
    targetName: 'broken',
    durationMs: 30,
    warmupMs: 0,
    concurrency: 2,
    keys: 2,
  });

  assert.equal(result.cycles, 0);
  assert.ok(result.errors > 0);
  assert.ok(result.errorExamples.length > 0);
  assert.ok(result.errorExamples.length <= 5);
  assert.equal(result.latencyMs.p50, 0);
});

test('benchmark validates its workload dimensions', async () => {
  const adapter = {
    name: 'noop',
    async acquire(key) {
      return { key };
    },
    async release() {},
  };

  await assert.rejects(
    runBenchmark({
      adapter,
      targetName: 'invalid',
      durationMs: 0,
    }),
    /durationMs must be a positive integer/,
  );
});

test('CLI parser accepts repeatable targets and both option syntaxes', () => {
  const parsed = parseArguments([
    '--target=node=live-mutex-http=http://127.0.0.1:6971',
    '--target',
    'fiducia=fiducia-http=http://127.0.0.1:8090',
    '--duration-ms=10',
    '--warmup-ms',
    '0',
    '--auth-token=public-token',
    '--fiducia-internal-auth',
    'cluster-secret',
    '--fiducia-org-id=org-a',
  ]);

  assert.equal(parsed.targets.length, 2);
  assert.equal(parsed.targets[1].adapter, 'fiducia-http');
  assert.equal(parsed.durationMs, 10);
  assert.equal(parsed.warmupMs, 0);
  assert.equal(parsed.authToken, 'public-token');
  assert.equal(parsed.fiduciaInternalAuth, 'cluster-secret');
  assert.equal(parsed.fiduciaOrgId, 'org-a');
  assert.throws(
    () => parseArguments(['--target=malformed']),
    /NAME=ADAPTER=URL/,
  );
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
