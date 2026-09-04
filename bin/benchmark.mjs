#!/usr/bin/env node

import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { createAdapter } from '../src/adapters.mjs';
import { runBenchmark } from '../src/benchmark.mjs';

/**
 * @typedef {{ name: string, adapter: string, url: string }} BenchmarkTarget
 * @typedef {{
 *   targets: BenchmarkTarget[],
 *   durationMs: number,
 *   warmupMs: number,
 *   concurrency: number,
 *   keys: number,
 *   requestTimeoutMs: number,
 *   ttlMs: number,
 *   authToken: string | undefined,
 *   fiduciaInternalAuth: string | undefined,
 *   fiduciaOrgId: string | undefined,
 *   json: boolean,
 *   help: boolean,
 * }} BenchmarkCliOptions
 */

const HELP = `Usage:
  npm run benchmark -- \\
    --target node=live-mutex-http=http://127.0.0.1:6971 \\
    --target rust=live-mutex-rs-http=http://127.0.0.1:6972 \\
    --target mills=live-mutex-mills-http=http://127.0.0.1:9200 \\
    --target fiducia=fiducia-http=http://127.0.0.1:8090

Options:
  --target NAME=ADAPTER=URL       Repeat for each running implementation.
  --duration-ms N                 Measured window per target (default: 3000).
  --warmup-ms N                   Warmup window per target (default: 500).
  --concurrency N                 Concurrent workers (default: 8).
  --keys N                        Lock-key cardinality (default: 64).
  --request-timeout-ms N          Timeout for one HTTP request (default: 5000).
  --ttl-ms N                      Requested lock lease (default: 30000).
  --auth-token TOKEN              Bearer token, primarily for Fiducia.
  --fiducia-internal-auth SECRET  Direct-node x-fiducia-internal-auth value.
  --fiducia-org-id ID             Direct-node x-fiducia-org-id value.
  --json                          Emit machine-readable JSON.
  --help                          Show this help.
`;

export function parseArguments(argv) {
  /** @type {BenchmarkCliOptions} */
  const parsed = {
    targets: [],
    durationMs: 3_000,
    warmupMs: 500,
    concurrency: 8,
    keys: 64,
    requestTimeoutMs: 5_000,
    ttlMs: 30_000,
    authToken: undefined,
    fiduciaInternalAuth: undefined,
    fiduciaOrgId: undefined,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    const [name, inlineValue] = splitOption(raw);
    if (name === '--json' || name === '--help') {
      parsed[name.slice(2)] = true;
      continue;
    }

    const value = inlineValue ?? argv[++index];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${name} requires a value`);
    }
    switch (name) {
      case '--target':
        parsed.targets.push(parseTarget(value));
        break;
      case '--duration-ms':
        parsed.durationMs = integer(value, name, { allowZero: false });
        break;
      case '--warmup-ms':
        parsed.warmupMs = integer(value, name, { allowZero: true });
        break;
      case '--concurrency':
        parsed.concurrency = integer(value, name, { allowZero: false });
        break;
      case '--keys':
        parsed.keys = integer(value, name, { allowZero: false });
        break;
      case '--request-timeout-ms':
        parsed.requestTimeoutMs = integer(value, name, { allowZero: false });
        break;
      case '--ttl-ms':
        parsed.ttlMs = integer(value, name, { allowZero: false });
        break;
      case '--auth-token':
        parsed.authToken = value;
        break;
      case '--fiducia-internal-auth':
        parsed.fiduciaInternalAuth = value;
        break;
      case '--fiducia-org-id':
        parsed.fiduciaOrgId = value;
        break;
      default:
        throw new Error(`unknown option: ${name}`);
    }
  }

  return parsed;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (options.targets.length === 0) {
    process.stderr.write(`At least one --target is required.\n\n${HELP}`);
    return 2;
  }

  const results = [];
  for (const target of options.targets) {
    if (!options.json) {
      process.stderr.write(`Benchmarking ${target.name} (${target.adapter}) at ${target.url}…\n`);
    }
    try {
      const adapter = createAdapter(target.adapter, {
        baseUrl: target.url,
        requestTimeoutMs: options.requestTimeoutMs,
        ttlMs: options.ttlMs,
        authToken: options.authToken,
        fiduciaInternalAuth: options.fiduciaInternalAuth,
        fiduciaOrgId: options.fiduciaOrgId,
      });
      results.push(await runBenchmark({
        adapter,
        targetName: target.name,
        durationMs: options.durationMs,
        warmupMs: options.warmupMs,
        concurrency: options.concurrency,
        keys: options.keys,
      }));
    } catch (error) {
      results.push({
        target: target.name,
        adapter: target.adapter,
        fatalError: error instanceof Error ? error.message : String(error),
        cycles: 0,
        errors: 1,
      });
    }
  }

  const report = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    config: {
      durationMs: options.durationMs,
      warmupMs: options.warmupMs,
      concurrency: options.concurrency,
      keys: options.keys,
      requestTimeoutMs: options.requestTimeoutMs,
      ttlMs: options.ttlMs,
    },
    results,
  };

  process.stdout.write(options.json
    ? `${JSON.stringify(report, null, 2)}\n`
    : renderMarkdown(report));

  return results.some(({ errors, fatalError }) => errors > 0 || fatalError) ? 1 : 0;
}

function renderMarkdown(report) {
  const lines = [
    `Benchmark completed ${report.observedAt} on Node ${report.environment.node} `
      + `(${report.environment.platform}/${report.environment.architecture}).`,
    '',
    '| Target | Adapter | Cycles | Cycles/s | p50 ms | p95 ms | p99 ms | Errors |',
    '|---|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const result of report.results) {
    lines.push([
      result.target,
      result.adapter,
      result.cycles,
      result.opsPerSecond ?? 0,
      result.latencyMs?.p50 ?? 0,
      result.latencyMs?.p95 ?? 0,
      result.latencyMs?.p99 ?? 0,
      result.errors,
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    if (result.fatalError) {
      lines.push('', `**${result.target} failed:** ${result.fatalError}`, '');
    }
  }
  return `${lines.join('\n')}\n`;
}

function parseTarget(value) {
  const first = value.indexOf('=');
  const second = value.indexOf('=', first + 1);
  if (first <= 0 || second <= first + 1 || second === value.length - 1) {
    throw new Error('--target must use NAME=ADAPTER=URL');
  }
  const target = {
    name: value.slice(0, first),
    adapter: value.slice(first + 1, second),
    url: value.slice(second + 1),
  };
  new URL(target.url);
  return target;
}

function splitOption(raw) {
  const separator = raw.indexOf('=');
  return separator === -1
    ? [raw, undefined]
    : [raw.slice(0, separator), raw.slice(separator + 1)];
}

function integer(raw, name, { allowZero }) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`${name} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`);
  }
  return value;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
