import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const MAX_LATENCY_SAMPLES = 1_000_000;
const MAX_ERROR_EXAMPLES = 5;

export async function runBenchmark({
  adapter,
  targetName,
  durationMs = 3_000,
  warmupMs = 500,
  concurrency = 8,
  keys = 64,
}) {
  requirePositiveInteger(durationMs, 'durationMs');
  requireNonNegativeInteger(warmupMs, 'warmupMs');
  requirePositiveInteger(concurrency, 'concurrency');
  requirePositiveInteger(keys, 'keys');
  if (!adapter?.acquire || !adapter?.release) {
    throw new Error('adapter must expose acquire() and release()');
  }

  const runId = randomUUID();
  if (warmupMs > 0) {
    const warmup = await runWindow({
      adapter,
      concurrency,
      durationMs: warmupMs,
      keyCount: keys,
      keyPrefix: `warmup-${runId}`,
      runId,
      collectLatency: false,
    });
    if (warmup.errors > 0) {
      throw new Error(
        `${targetName} warmup failed: ${warmup.errorExamples.join('; ')}`,
      );
    }
  }

  const measured = await runWindow({
    adapter,
    concurrency,
    durationMs,
    keyCount: keys,
    keyPrefix: `bench-${runId}`,
    runId,
    collectLatency: true,
  });
  const sorted = measured.latenciesMs.toSorted((a, b) => a - b);

  return {
    target: targetName,
    adapter: adapter.name,
    durationMs: round(measured.elapsedMs, 3),
    configuredDurationMs: durationMs,
    warmupMs,
    concurrency,
    keys,
    cycles: measured.cycles,
    errors: measured.errors,
    errorExamples: measured.errorExamples,
    samples: sorted.length,
    samplesTruncated: measured.samplesTruncated,
    opsPerSecond: round(measured.cycles / (measured.elapsedMs / 1_000), 2),
    latencyMs: {
      average: round(average(sorted), 3),
      p50: round(percentile(sorted, 0.50), 3),
      p95: round(percentile(sorted, 0.95), 3),
      p99: round(percentile(sorted, 0.99), 3),
      max: round(sorted.at(-1) ?? 0, 3),
    },
  };
}

async function runWindow({
  adapter,
  concurrency,
  durationMs,
  keyCount,
  keyPrefix,
  runId,
  collectLatency,
}) {
  const stats = {
    cycles: 0,
    errors: 0,
    errorExamples: [],
    latenciesMs: [],
    samplesTruncated: false,
  };
  const startedAt = performance.now();
  const deadline = startedAt + durationMs;

  await Promise.all(Array.from({ length: concurrency }, (_, workerId) =>
    runWorker({
      adapter,
      collectLatency,
      concurrency,
      deadline,
      keyCount,
      keyPrefix,
      runId,
      stats,
      workerId,
    })));

  stats.elapsedMs = performance.now() - startedAt;
  return stats;
}

async function runWorker({
  adapter,
  collectLatency,
  concurrency,
  deadline,
  keyCount,
  keyPrefix,
  runId,
  stats,
  workerId,
}) {
  let sequence = 0;
  while (performance.now() < deadline) {
    const keyIndex = (workerId + (sequence * concurrency)) % keyCount;
    const key = `${keyPrefix}-${keyIndex}`;
    const attempt = `${runId}-${workerId}-${sequence}`;
    const context = {
      holder: `holder-${attempt}`,
      requestId: `request-${attempt}`,
      workerId,
      sequence,
    };
    const cycleStartedAt = performance.now();

    try {
      const grant = await adapter.acquire(key, context);
      await adapter.release(grant, context);
      stats.cycles += 1;
      if (collectLatency) {
        if (stats.latenciesMs.length < MAX_LATENCY_SAMPLES) {
          stats.latenciesMs.push(performance.now() - cycleStartedAt);
        } else {
          stats.samplesTruncated = true;
        }
      }
    } catch (error) {
      stats.errors += 1;
      if (stats.errorExamples.length < MAX_ERROR_EXAMPLES) {
        stats.errorExamples.push(error instanceof Error ? error.message : String(error));
      }
      await delay(10);
    }
    sequence += 1;
  }
}

function percentile(sorted, quantile) {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index];
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function requireNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
