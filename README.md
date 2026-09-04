# Locking library comparison

[![CI](https://github.com/ORESoftware/locking-lib-comparison/actions/workflows/ci.yml/badge.svg)](https://github.com/ORESoftware/locking-lib-comparison/actions/workflows/ci.yml)
[![Upstream smoke](https://github.com/ORESoftware/locking-lib-comparison/actions/workflows/upstream-smoke.yml/badge.svg)](https://github.com/ORESoftware/locking-lib-comparison/actions/workflows/upstream-smoke.yml)

A reproducible source catalog and acquire/release benchmark for every public
`ORESoftware/live-mutex*` repository and the locking surface of
[fiducia.cloud](https://fiducia.cloud).

This repository used to time 300 operations against `live-mutex@0.0.10006` and
`lockfile@1.0.3`. That 2016 comparison mixed a network broker with a local
filesystem lock, used different failure behavior in parallel mode, and measured
with `Date.now()`. Version 2 replaces it with protocol-aware adapters, warmup,
concurrent workers, percentile latency, pinned source revisions, automated
tests, and explicit architecture caveats.

## Current source snapshot

Snapshot observed **2026-07-28**. The full machine-readable record is
[`data/projects.json`](data/projects.json); revisions are pinned so a result can
name the code it actually measured.

| Project | Role | Version / revision | Architecture | Automatic failover |
|---|---|---|---|---|
| [`live-mutex`](https://github.com/ORESoftware/live-mutex) | implementation | npm `0.2.27` / `682d73980c00` | Single event-driven Node.js broker | No |
| [`live-mutex-examples`](https://github.com/ORESoftware/live-mutex-examples) | examples | `0.0.1001` / `22cec4608c51` | Example code, not an implementation | N/A |
| [`live-mutex-mills.rs`](https://github.com/ORESoftware/live-mutex-mills.rs) | implementation | `0.1.0` / `3659a70a64b2` | Leaderless quorum voting; majority or Maekawa grid | Lease-based |
| [`live-mutex-rs`](https://github.com/ORESoftware/live-mutex-rs) | implementation | `0.1.127` / `c1cb33e4cb01` | Rust single broker; optional experimental BrokerRaft | Experimental Raft |
| [`live-mutex.distributed`](https://github.com/ORESoftware/live-mutex.distributed) | implementation/core | `0.2.25` / `c6bfb46aef45` | Node.js broker plus exported leaderless consensus core | Consensus core only |
| [`fiducia-node.rs`](https://github.com/fiducia-cloud/fiducia-node.rs) | implementation | `0.1.0` / `7d79af1ec754` | Sharded multi-Raft coordination data plane | Yes |
| [`fiducia-clients`](https://github.com/fiducia-cloud/fiducia-clients) | client suite | workspace / `d12a3853995b` | Multi-language Fiducia HTTP SDKs | Service-owned |

Render the catalog or check whether a tracked branch/version moved:

```bash
npm run catalog
npm run catalog -- --json
npm run refresh -- --check
```

`npm run refresh -- --write` deliberately updates the pinned snapshot. Review
the source changes before committing the result.

## What is comparable

The benchmark measures one successful exclusive-lock acquire followed by its
matching release. That common denominator exists across the four supported HTTP
contracts:

| Adapter | Acquire | Release | Ownership proof |
|---|---|---|---|
| `live-mutex-http` | `POST /v1/lock` | `POST /v1/unlock` | `lockUuid` |
| `live-mutex-rs-http` | `POST /v1/lock` | `POST /v1/unlock` | `lockUuid` |
| `live-mutex-mills-http` | `POST /locks/:key/acquire` | `POST /locks/:key/release` | `holder` |
| `fiducia-http` | `POST /v1/locks/acquire` | `POST /v1/locks/release` | `holder` + `fencing_token` |

`live-mutex` and `live-mutex.distributed` use the same adapter. They must run as
separate targets if both are being compared. `live-mutex-examples` is cataloged
and smoke-tested but is not benchmarked because it is not an independent lock
service.

The adapters fail closed: HTTP success with an unexpected body is counted as an
error, not as a completed cycle.

## Run the benchmark

Node.js **22 or newer** is required.
See [Starting the comparison targets](docs/STARTING_TARGETS.md) for reproducible
commands for each upstream implementation.

```bash
npm ci
npm test

npm run benchmark -- \
  --target node=live-mutex-http=http://127.0.0.1:6971 \
  --target rust=live-mutex-rs-http=http://127.0.0.1:6972 \
  --target mills=live-mutex-mills-http=http://127.0.0.1:9200 \
  --target fiducia=fiducia-http=http://127.0.0.1:8090 \
  --duration-ms 10000 \
  --warmup-ms 1000 \
  --concurrency 16 \
  --keys 256
```

Use `--json` for a report suitable for a CI artifact:

```bash
npm run benchmark -- \
  --target rust=live-mutex-rs-http=http://127.0.0.1:6971 \
  --duration-ms 10000 \
  --json > benchmark.json
```

If Fiducia’s public edge requires authentication, pass `--auth-token "$TOKEN"`.
For a direct `fiducia-node.rs` endpoint, pass both
`--fiducia-internal-auth "$FIDUCIA_INTERNAL_SECRET"` and
`--fiducia-org-id "$FIDUCIA_ORG_ID"` instead. Fiducia credentials are sent only
by the `fiducia-http` adapter, and secrets are never included in the report.

Run `npm run benchmark -- --help` for every option.

### Reading a result

- A cycle is counted only after both acquire and release succeed.
- Throughput is completed cycles divided by the measured wall-clock window.
- p50, p95, p99, average, and maximum cover the full acquire-plus-release cycle.
- Warmup traffic is validated but excluded from measurements.
- Up to five representative errors are retained; any error makes the CLI exit
  nonzero.
- With at least as many keys as workers, workers start on distinct keys. Set a
  smaller key count to measure deliberate contention.

## Fair-comparison rules

These systems do not offer the same durability or failure semantics. A higher
number from a single broker is not evidence that it is “better” than a quorum
commit, and an unsafe no-fsync mode must not be compared with a crash-durable
default without being labeled.

For publishable results:

1. Record the catalog revision, hardware, OS/kernel, Node/Rust versions, network
   placement, transport, and every durability flag.
2. Use the same client host, key cardinality, concurrency, duration, warmup, TTL,
   and authentication path for every target.
3. Run at least five trials, rotate target order, and report all trials rather
   than only the fastest.
4. Separate uncontended (`keys >= concurrency`) and contended
   (`keys < concurrency`) workloads.
5. Test failover, stale-holder fencing, queue fairness, TTL expiry, and
   cancellation separately from throughput.
6. Do not compare a debug build with a release build.
7. Never run the benchmark against production lock namespaces. Every run uses a
   random key prefix, but the target service is still mutated.

No benchmark numbers are committed here by default. Hardware-dependent sample
results become misleading quickly; the workflow stores timestamped JSON
artifacts instead.

## Capability and maturity notes

- **`live-mutex`** is the simplest published Node.js choice and has no broker
  failover. Its current npm release is `0.2.27`.
- **`live-mutex-rs`** is the closest Rust counterpart, with TCP, Unix-socket,
  and HTTP transports. Its BrokerRaft path is explicitly described upstream as
  experimental.
- **`live-mutex-mills.rs`** explores leaderless quorum locking. Its README
  documents a token-durability window between reporting acquisition and
  Confirm reaching a quorum; treat the fencing guarantee accordingly.
- **`live-mutex.distributed`** exports a leaderless consensus engine, but its
  distributed README still lists integration with the regular broker as the
  next step. Its package is also named `live-mutex`, which makes repository and
  artifact identity easy to confuse.
- **Fiducia** provides a broader, HTTP-only coordination platform with
  multi-key union locks, semaphores, leases, cancellation, and Raft-backed
  durability. Its reader/writer routes are reserved in the client protocol but
  are not currently live node endpoints.
- **`live-mutex-examples`** still pins `live-mutex@0.2.0`; use it as historical
  example material until that dependency and code are refreshed.

The capability strings in `data/projects.json` intentionally include values
such as `experimental-raft`, `core-only`, and `yes-with-known-window`. Reducing
those to booleans would hide the most important differences.

## Automation

- **CI** runs TypeScript 7 type-checking and Node tests on Node 22 and 24.
- **Source snapshot** checks tracked branches and package versions daily.
- **Upstream smoke** checks all five `live-mutex*` repositories plus Fiducia’s
  node and TypeScript/Python clients weekly.
- **Benchmark** is manually dispatched against operator-supplied endpoints and
  uploads the JSON report as an artifact.

The upstream workflow follows moving branches on purpose. It answers “does the
newest upstream still build and test?” The catalog pins commits for the
different question “what exact code did this comparison describe?”

## Repository layout

```text
bin/benchmark.mjs              benchmark CLI
bin/catalog.mjs                catalog renderer
data/projects.json             pinned source and capability snapshot
scripts/refresh-snapshot.mjs   GitHub/npm drift detector
src/adapters.mjs               four HTTP protocol adapters
src/benchmark.mjs              workload and metrics engine
src/catalog.mjs                catalog validation/rendering
test/                          adapter, workload, and catalog tests
.github/workflows/             CI, source watch, upstream smoke, benchmark
```

## Contributing

When adding a target:

1. Add it to `data/projects.json` with a full commit SHA and honest maturity
   qualifiers.
2. Add a protocol adapter only if a complete acquire/release cycle can be
   validated.
3. Add request/response contract tests before adding benchmark instructions.
4. Add the repository’s native build/test command to the upstream smoke
   workflow.
5. Keep performance claims out of the README unless the raw report,
   environment, and exact revisions are also published.
