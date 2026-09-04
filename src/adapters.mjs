export const ADAPTER_NAMES = Object.freeze([
  'fiducia-http',
  'live-mutex-http',
  'live-mutex-mills-http',
  'live-mutex-rs-http',
]);

export function createAdapter(name, options) {
  if (!ADAPTER_NAMES.includes(name)) {
    throw new Error(`unknown adapter "${name}"; expected one of: ${ADAPTER_NAMES.join(', ')}`);
  }

  const request = createJsonRequester({
    ...options,
    authToken: name === 'fiducia-http' ? options?.authToken : undefined,
    fiduciaInternalAuth: name === 'fiducia-http' ? options?.fiduciaInternalAuth : undefined,
    fiduciaOrgId: name === 'fiducia-http' ? options?.fiduciaOrgId : undefined,
  });
  const ttlMs = positiveInteger(options?.ttlMs ?? 30_000, 'ttlMs');

  switch (name) {
    case 'live-mutex-http':
      return {
        name,
        async acquire(key) {
          const body = await request('/v1/lock', { key, ttl: ttlMs });
          if (body.acquired !== true || typeof body.lockUuid !== 'string') {
            throw responseError(name, 'acquire', body);
          }
          return { key, lockUuid: body.lockUuid };
        },
        async release(grant) {
          const body = await request('/v1/unlock', {
            key: grant.key,
            lockUuid: grant.lockUuid,
          });
          if (body.released !== true) {
            throw responseError(name, 'release', body);
          }
        },
      };

    case 'live-mutex-rs-http':
      return {
        name,
        async acquire(key) {
          const body = await request('/v1/lock', {
            key,
            ttlMs,
            waitMs: 0,
          });
          if (body.acquired !== true || typeof body.lockUuid !== 'string') {
            throw responseError(name, 'acquire', body);
          }
          return { key, lockUuid: body.lockUuid };
        },
        async release(grant) {
          const body = await request('/v1/unlock', {
            key: grant.key,
            lockUuid: grant.lockUuid,
          });
          if (body.unlocked !== true) {
            throw responseError(name, 'release', body);
          }
        },
      };

    case 'live-mutex-mills-http':
      return {
        name,
        async acquire(key) {
          const body = await request(`/locks/${encodeURIComponent(key)}/acquire`, {});
          if (
            body.ok !== true
            || typeof body.holder !== 'string'
            || typeof body.fence !== 'number'
          ) {
            throw responseError(name, 'acquire', body);
          }
          return { key, holder: body.holder, fence: body.fence };
        },
        async release(grant) {
          const body = await request(`/locks/${encodeURIComponent(grant.key)}/release`, {
            holder: grant.holder,
          });
          if (body.ok !== true) {
            throw responseError(name, 'release', body);
          }
        },
      };

    case 'fiducia-http':
      return {
        name,
        async acquire(key, context) {
          const holder = context?.holder;
          const requestId = context?.requestId;
          if (!holder || !requestId) {
            throw new Error('fiducia-http requires a unique holder and requestId per attempt');
          }
          const body = await request('/v1/locks/acquire', {
            key,
            holder,
            request_id: requestId,
            ttl_ms: ttlMs,
            wait: false,
          });
          const output = fiduciaOutput(body, 'acquire');
          if (output.acquired !== true || !Number.isSafeInteger(output.fencing_token)) {
            throw responseError(name, 'acquire', body);
          }
          return {
            key,
            holder,
            fencingToken: output.fencing_token,
          };
        },
        async release(grant) {
          const body = await request('/v1/locks/release', {
            holder: grant.holder,
            fencing_token: grant.fencingToken,
          });
          const output = fiduciaOutput(body, 'release');
          if (output.released !== true) {
            throw responseError(name, 'release', body);
          }
        },
      };

    default:
      throw new Error(`adapter "${name}" is not implemented`);
  }
}

function createJsonRequester(options = {}) {
  const baseUrl = new URL(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = positiveInteger(options.requestTimeoutMs ?? 5_000, 'requestTimeoutMs');
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
  };
  if (options.authToken) {
    headers.authorization = `Bearer ${options.authToken}`;
  }
  if (options.fiduciaInternalAuth) {
    headers['x-fiducia-internal-auth'] = options.fiduciaInternalAuth;
  }
  if (options.fiduciaOrgId) {
    headers['x-fiducia-org-id'] = options.fiduciaOrgId;
  }

  return async (path, body) => {
    const response = await fetchImpl(new URL(path, baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let value;
    try {
      value = text.length === 0 ? {} : JSON.parse(text);
    } catch {
      throw new Error(`${response.status} ${path} returned non-JSON: ${text.slice(0, 200)}`);
    }
    if (!response.ok) {
      throw new Error(`${response.status} ${path}: ${JSON.stringify(value)}`);
    }
    return value;
  };
}

function fiduciaOutput(body, operation) {
  if (body?.committed !== true || typeof body?.result?.output !== 'object') {
    throw responseError('fiducia-http', operation, body);
  }
  return body.result.output;
}

function responseError(adapter, operation, body) {
  return new Error(`${adapter} ${operation} returned an unexpected response: ${JSON.stringify(body)}`);
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
