# Starting local benchmark targets

These commands are development conveniences, not deployment guidance. Run each
service in its own checkout and terminal. To reproduce the catalog exactly,
check out the full revision from `data/projects.json` after cloning.

Use release/production builds for measured runs. Confirm each health endpoint
before starting the benchmark, and keep the services on the same host unless
network placement is the variable being tested.

## live-mutex

```bash
git clone --branch dev https://github.com/ORESoftware/live-mutex.git
cd live-mutex
npm ci
npm run build
LMX_HTTP_PORT=6971 node assets/cli/start-server.js
```

Benchmark target:

```text
--target node=live-mutex-http=http://127.0.0.1:6971
```

## live-mutex.distributed

The current repository still starts the regular broker for its public HTTP lock
surface. Its exported consensus engine is cataloged separately as an
experimental/core capability.

```bash
git clone --branch main https://github.com/ORESoftware/live-mutex.distributed.git
cd live-mutex.distributed
npm ci
npm run build
LMX_HTTP_PORT=6972 node assets/cli/start-server.js
```

Benchmark target:

```text
--target distributed=live-mutex-http=http://127.0.0.1:6972
```

## live-mutex-rs

```bash
git clone --branch dev https://github.com/ORESoftware/live-mutex-rs.git
cd live-mutex-rs
LMX_TCP_PORT=6973 LMX_HTTP_PORT=6974 \
  cargo run --release --locked --no-default-features
```

Benchmark target:

```text
--target rust=live-mutex-rs-http=http://127.0.0.1:6974
```

That command starts the single-broker implementation. BrokerRaft has different
durability and topology requirements; follow the upstream Raft documentation
and report its settings explicitly rather than silently substituting it.

## live-mutex-mills.rs

Build once:

```bash
git clone --branch main https://github.com/ORESoftware/live-mutex-mills.rs.git
cd live-mutex-mills.rs
cargo build --release --locked
```

Then start three nodes in separate terminals from the same checkout:

```bash
target/release/lmxd --no-stdin --client-http 127.0.0.1:9200 \
  0 127.0.0.1:9100 127.0.0.1:9101 127.0.0.1:9102

target/release/lmxd --no-stdin --client-http 127.0.0.1:9201 \
  1 127.0.0.1:9100 127.0.0.1:9101 127.0.0.1:9102

target/release/lmxd --no-stdin --client-http 127.0.0.1:9202 \
  2 127.0.0.1:9100 127.0.0.1:9101 127.0.0.1:9102
```

Benchmark one stable node endpoint. Acquire and release must return to the same
node because that node is the protocol requester holding the quorum votes.

```text
--target mills=live-mutex-mills-http=http://127.0.0.1:9200
```

## fiducia-node.rs

Fiducia currently uses sibling path dependencies for its routing and generated
interfaces crates, so clone all three under one parent:

```bash
mkdir fiducia-local
cd fiducia-local
git clone --branch main https://github.com/fiducia-cloud/fiducia-node.rs.git
git clone --branch main https://github.com/fiducia-cloud/fiducia-routing.rs.git
git clone --branch main https://github.com/fiducia-cloud/fiducia-interfaces.git
cd fiducia-node.rs
FIDUCIA_INTERNAL_SECRET=dev-secret \
FIDUCIA_DATA_DIR=/tmp/fiducia-benchmark-data \
  cargo run --release --locked
```

The node listens on port 8090 by default. Pass both direct-node headers:

```text
--target fiducia=fiducia-http=http://127.0.0.1:8090 \
--fiducia-internal-auth dev-secret \
--fiducia-org-id benchmark-org
```

This starts Fiducia’s single-node development topology. Do not label its result
as a replicated multi-Raft comparison. A real HA result must record replica
count, shard count, leader placement, storage class, fsync policy, and network
placement.

## Readiness checks

Before timing:

```bash
curl --fail http://127.0.0.1:6971/healthz
curl --fail http://127.0.0.1:6974/healthz
curl --fail -H 'x-fiducia-internal-auth: dev-secret' \
  http://127.0.0.1:8090/v1/status
```

`live-mutex-mills.rs` does not currently expose a health route; verify that all
three processes logged their peer and client listeners, then perform a short
warmup benchmark before the measured run.
