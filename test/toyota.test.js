// The real transport against a loopback HTTP server, and the error mapping.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  ToyotaError,
  apiError,
  errorReason,
  httpRequest,
  networkError,
  parseObject,
  parseRetryAfter,
  responseCode,
} from '../src/toyota.js';
import { apigw403 } from './fixtures/toyota.js';

async function serve(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('a request: method, headers, body; the answer whatever its status', async (t) => {
  let seen;
  const base = await serve(t, (req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen = {
        method: req.method,
        url: req.url,
        vin: req.headers.vin,
        key: req.headers.api_key,
        body,
      };
      res.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': ['a=1; Path=/', 'b=2'],
      });
      res.end('{"payload":{}}');
    });
  });
  const answer = await httpRequest(`${base}/json/realms/root/realms/tme/authenticate?x=1`, {
    method: 'POST',
    headers: { vin: 'JT123', API_KEY: 'k', 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(answer.status, 200);
  assert.equal(answer.body, '{"payload":{}}');
  assert.deepEqual(answer.headers['set-cookie'], ['a=1; Path=/', 'b=2']);
  assert.deepEqual(seen, {
    method: 'POST',
    url: '/json/realms/root/realms/tme/authenticate?x=1',
    vin: 'JT123',
    key: 'k',
    body: '{}',
  });
});

test('a redirect is returned, never followed (the custom scheme of the app)', async (t) => {
  const base = await serve(t, (req, res) => {
    res.writeHead(302, { location: 'com.toyota.oneapp:/oauth2Callback?code=abc' });
    res.end();
  });
  const answer = await httpRequest(`${base}/authorize`);
  assert.equal(answer.status, 302);
  assert.equal(answer.headers.location, 'com.toyota.oneapp:/oauth2Callback?code=abc');
});

test('a silent server times out, a huge answer is cut, a closed port is a network error', async (t) => {
  const base = await serve(t, (req, res) => {
    if (req.url === '/big') {
      res.writeHead(200);
      res.end('x'.repeat(2048));
    }
    // /slow never answers
  });
  await assert.rejects(httpRequest(`${base}/slow`, { timeout: 50 }), { kind: 'timeout' });
  await assert.rejects(httpRequest(`${base}/big`, { maxBytes: 1024 }), { kind: 'size' });
  await assert.rejects(httpRequest('http://127.0.0.1:1/'), { kind: 'network' });
});

test('the errors of the API answers, with their response code', () => {
  const at = (status, body, headers) => ({ status, body: JSON.stringify(body), headers });
  const forbidden = apiError(at(403, apigw403()));
  assert.deepEqual(
    [forbidden.kind, forbidden.code, forbidden.detail],
    ['forbidden', 'APIGW-403', 'invalid guid and vin mapping'],
  );
  assert.equal(
    errorReason(forbidden),
    'request refused (HTTP 403, APIGW-403: invalid guid and vin mapping)',
  );
  const limited = apiError(at(429, {}, { 'retry-after': '60' }));
  assert.deepEqual([limited.kind, limited.retryAfter], ['rate_limited', 60_000]);
  assert.equal(apiError(at(401, {})).kind, 'unauthorized');
  assert.equal(apiError({ status: 404, body: '<html></html>' }).kind, 'not_found');
  assert.equal(apiError(at(400, {})).kind, 'rejected');
  assert.equal(apiError(at(503, {})).kind, 'unavailable');
  assert.equal(responseCode(apigw403()), 'APIGW-403');
  assert.equal(responseCode({ status: 'SUCCESS' }), undefined);
});

test('reasons never carry the request, Retry-After in seconds or as a date', () => {
  assert.equal(
    errorReason(
      new ToyotaError('forbidden', 'request refused', { status: 403, code: 'APIGW-403' }),
    ),
    'request refused (HTTP 403, APIGW-403)',
  );
  assert.equal(
    errorReason(new ToyotaError('unavailable', 'down', { status: 503 })),
    'down (HTTP 503)',
  );
  assert.equal(errorReason(networkError({ code: 'ENOTFOUND' })), 'unknown host name');
  assert.equal(errorReason(new Error('plain')), 'plain');
  assert.equal(parseRetryAfter('120'), 120_000);
  assert.equal(parseRetryAfter('Fri, 16 Oct 2026 10:01:00 GMT', Date.UTC(2026, 9, 16, 10)), 60_000);
  assert.equal(parseRetryAfter(''), undefined);
  assert.equal(parseRetryAfter('later'), undefined);
});

test('answers must be JSON objects', () => {
  assert.deepEqual(parseObject('{"a":1}'), { a: 1 });
  assert.throws(() => parseObject('[1]'), { kind: 'bad_response' });
  assert.throws(() => parseObject('<html>'), { kind: 'bad_response' });
});
