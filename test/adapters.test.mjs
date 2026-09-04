import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdapter } from '../src/adapters.mjs';

test('live-mutex HTTP adapter uses the Node broker contract', async () => {
  const mock = mockFetch([
    { acquired: true, lockUuid: 'node-lock', fencingToken: 4 },
    { released: true },
  ]);
  const adapter = createAdapter('live-mutex-http', {
    ...options(mock.fetch),
    authToken: 'fiducia-bearer',
    fiduciaInternalAuth: 'fiducia-cluster-secret',
    fiduciaOrgId: 'fiducia-org',
  });
  const grant = await adapter.acquire('orders/1');
  await adapter.release(grant);

  assert.deepEqual(mock.calls.map(callSummary), [
    {
      path: '/v1/lock',
      body: { key: 'orders/1', ttl: 1234 },
    },
    {
      path: '/v1/unlock',
      body: { key: 'orders/1', lockUuid: 'node-lock' },
    },
  ]);
  assert.equal(mock.calls[0].options.headers.authorization, undefined);
  assert.equal(mock.calls[0].options.headers['x-fiducia-internal-auth'], undefined);
  assert.equal(mock.calls[0].options.headers['x-fiducia-org-id'], undefined);
});

test('live-mutex-rs HTTP adapter uses camelCase wait and lease fields', async () => {
  const mock = mockFetch([
    { acquired: true, lockUuid: 'rust-lock', fencingTokens: { 'orders/2': 8 } },
    { unlocked: true, keys: ['orders/2'] },
  ]);
  const adapter = createAdapter('live-mutex-rs-http', options(mock.fetch));
  const grant = await adapter.acquire('orders/2');
  await adapter.release(grant);

  assert.deepEqual(mock.calls.map(callSummary), [
    {
      path: '/v1/lock',
      body: { key: 'orders/2', ttlMs: 1234, waitMs: 0 },
    },
    {
      path: '/v1/unlock',
      body: { key: 'orders/2', lockUuid: 'rust-lock' },
    },
  ]);
});

test('live-mutex-mills HTTP adapter releases with the broker holder token', async () => {
  const mock = mockFetch([
    { ok: true, lock: 'orders/3', fence: 12, holder: 'h1' },
    { ok: true, lock: 'orders/3' },
  ]);
  const adapter = createAdapter('live-mutex-mills-http', options(mock.fetch));
  const grant = await adapter.acquire('orders/3');
  await adapter.release(grant);

  assert.deepEqual(mock.calls.map(callSummary), [
    {
      path: '/locks/orders%2F3/acquire',
      body: {},
    },
    {
      path: '/locks/orders%2F3/release',
      body: { holder: 'h1' },
    },
  ]);
});

test('Fiducia adapter unwraps the Raft commit envelope and passes auth', async () => {
  const mock = mockFetch([
    {
      committed: true,
      result: { output: { acquired: true, fencing_token: 19 } },
    },
    {
      committed: true,
      result: { output: { released: true } },
    },
  ]);
  const adapter = createAdapter('fiducia-http', {
    ...options(mock.fetch),
    authToken: 'secret',
    fiduciaInternalAuth: 'cluster-secret',
    fiduciaOrgId: 'org-a',
  });
  const grant = await adapter.acquire('orders/4', {
    holder: 'worker-a',
    requestId: 'request-a',
  });
  await adapter.release(grant);

  assert.deepEqual(mock.calls.map(callSummary), [
    {
      path: '/v1/locks/acquire',
      body: {
        key: 'orders/4',
        holder: 'worker-a',
        request_id: 'request-a',
        ttl_ms: 1234,
        wait: false,
      },
    },
    {
      path: '/v1/locks/release',
      body: { holder: 'worker-a', fencing_token: 19 },
    },
  ]);
  assert.equal(mock.calls[0].options.headers.authorization, 'Bearer secret');
  assert.equal(
    mock.calls[0].options.headers['x-fiducia-internal-auth'],
    'cluster-secret',
  );
  assert.equal(mock.calls[0].options.headers['x-fiducia-org-id'], 'org-a');
});

test('adapters fail closed on successful HTTP responses with the wrong shape', async () => {
  const mock = mockFetch([{ ok: true }]);
  const adapter = createAdapter('live-mutex-http', options(mock.fetch));

  await assert.rejects(
    adapter.acquire('broken'),
    /returned an unexpected response/,
  );
});

function options(fetchImpl) {
  return {
    baseUrl: 'http://example.test:9000',
    fetchImpl,
    requestTimeoutMs: 500,
    ttlMs: 1234,
  };
}

function mockFetch(responseBodies) {
  const calls = [];
  return {
    calls,
    async fetch(url, options) {
      calls.push({ url: new URL(url), options });
      const body = responseBodies.shift();
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  };
}

function callSummary({ url, options: requestOptions }) {
  return {
    path: url.pathname,
    body: JSON.parse(requestOptions.body),
  };
}
