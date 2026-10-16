// -----------------------------------------------------------------------------
// The MyToyota account: the sign-in rounds, the authorization code, the
// tokens, their renewal and the API calls, against the fake MyToyota.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { ToyotaClient, isoDay, tokenUuid } from '../src/client.js';
import { API, AUTH, BRANDS } from '../src/constants.js';
import {
  EMAIL,
  HOUR,
  ID_TOKEN,
  MINUTE,
  NOW,
  PASSWORD,
  UUID,
  VINS,
  missingToken,
} from './fixtures/toyota.js';
import { fakeToyota } from './helpers/fakeToyota.js';

function setup({ server = fakeToyota(), brand = BRANDS.toyota, session = null, gap = 0 } = {}) {
  let clock = NOW;
  const sessions = [];
  const sleeps = [];
  const client = new ToyotaClient({
    transport: server.transport,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    requestGap: gap,
    onSession: (s) => sessions.push(structuredClone(s)),
  });
  client.configure({ email: EMAIL, password: PASSWORD, brand, session });
  return {
    client,
    server,
    sessions,
    sleeps,
    advance: (ms) => {
      clock += ms;
    },
  };
}

test('the uuid of the id token, read without its signature', () => {
  assert.equal(tokenUuid(ID_TOKEN), UUID);
  assert.equal(tokenUuid('a.eyJ1dWlkIjoiYWJjIn0.b'), 'abc');
  assert.equal(tokenUuid('not a jwt'), undefined);
  assert.equal(tokenUuid(undefined), undefined);
  assert.equal(isoDay(NOW), '2026-10-16');
});

test('sign-in: the rounds of questions, the cookies, the code, the tokens', async () => {
  const { client, server, sessions } = setup();
  const answer = await client.vehicles();
  assert.equal(answer.payload.length, 2);
  const auth = server.requests.filter((r) => r.url === AUTH.authenticateUrl);
  assert.equal(auth.length, 4, 'three questions, then the token id');
  assert.deepEqual(auth[0].json, {});
  assert.equal(auth[0].headers.Cookie, undefined);
  // The load-balancer cookies of the first answer go with the next rounds.
  assert.match(auth[1].headers.Cookie, /route=96df7747ca52; amlbcookie=01/);
  const user = auth[2].json.callbacks.find((c) => c.output[0].value === 'User Name');
  assert.equal(user.input[0].value, EMAIL);
  const password = auth[3].json.callbacks.find((c) => c.type === 'PasswordCallback');
  assert.equal(password.input[0].value, PASSWORD);
  // The other questions (market, locales, choices) are sent back unchanged.
  assert.deepEqual(
    auth[1].json.callbacks.map((c) => c.input[0].value),
    ['', '', ''],
  );
  const [authorize] = server.requests.filter((r) => r.url === AUTH.authorizeUrl);
  assert.equal(authorize.headers.Cookie, 'iPlanetDirectoryPro=token-id-1');
  const [grant] = server.grants('authorization_code');
  assert.deepEqual(grant.form, {
    client_id: 'oneapp',
    code: 'code-1',
    redirect_uri: 'com.toyota.oneapp:/oauth2Callback',
    grant_type: 'authorization_code',
    code_verifier: 'plain',
  });
  assert.equal(grant.headers.Authorization, 'basic b25lYXBwOm9uZWFwcA==');
  assert.deepEqual(sessions, [
    {
      accessToken: 'access-1',
      expiresAt: NOW + 3599 * 1000,
      refreshToken: 'refresh-1',
      uuid: UUID,
    },
  ]);
});

test('the headers of the app on every API call', async () => {
  const { client, server } = setup();
  await client.telemetry(VINS.RAV4);
  const [call] = server.apiCalls();
  assert.equal(call.url, `${API.host}/v3/telemetry`);
  const h = call.headers;
  assert.equal(h.Authorization, 'Bearer access-1');
  assert.equal(h['x-api-key'], API.apiKey);
  assert.equal(h.API_KEY, API.apiKey);
  assert.equal(h['x-guid'], UUID);
  assert.equal(h.guid, UUID);
  // HMAC-SHA256 of the uuid, keyed with the app version (pytoyoda generate_hmac_sha256).
  assert.equal(h['x-client-ref'], createHmac('sha256', '2.14.0').update(UUID).digest('hex'));
  assert.match(h['x-correlationid'], /^[0-9a-f-]{36}$/);
  assert.equal(h['x-appversion'], '2.14.0');
  assert.equal(h['x-channel'], 'ONEAPP');
  assert.equal(h['x-brand'], 'T');
  assert.equal(h['x-region'], 'EU');
  assert.equal(h['x-user-region'], 'EU');
  assert.equal(h['User-Agent'], 'okhttp/4.10.0');
  assert.equal(h.vin, VINS.RAV4);
  assert.equal(h['x-appbrand'], undefined);
});

test('a Lexus account adds x-appbrand and brand', async () => {
  const { client, server } = setup({ brand: BRANDS.lexus });
  await client.vehicles();
  const [call] = server.apiCalls();
  assert.equal(call.headers['x-brand'], 'L');
  assert.equal(call.headers['x-appbrand'], 'L');
  assert.equal(call.headers.brand, 'L');
  assert.equal(call.headers.vin, undefined, 'no VIN on the vehicle list');
});

test('the trips of the last 90 days, newest first, one', async () => {
  const { client, server } = setup();
  await client.lastTrip(VINS.RAV4);
  const [call] = server.calls('trips');
  assert.deepEqual(call.query, {
    from: '2026-07-18',
    to: '2026-10-16',
    summary: 'false',
    limit: '1',
    offset: '0',
  });
});

test('the token is reused, then renewed with the refresh token', async () => {
  const { client, server, advance } = setup();
  await client.vehicles();
  await client.telemetry(VINS.RAV4);
  assert.equal(server.signIns().length, 1);
  advance(HOUR);
  await client.telemetry(VINS.RAV4);
  assert.equal(server.signIns().length, 1, 'no new sign-in');
  const [refresh] = server.grants('refresh_token');
  assert.equal(refresh.form.refresh_token, 'refresh-1');
  assert.equal(refresh.form.client_id, 'oneapp');
  assert.equal(server.apiCalls().at(-1).headers.Authorization, 'Bearer access-2');
  assert.equal(client.session.uuid, UUID);
});

test('a refused refresh token falls back once to the password', async () => {
  const { client, server, advance } = setup();
  await client.vehicles();
  server.refreshTokens.clear();
  advance(HOUR);
  await client.vehicles();
  assert.equal(server.grants('refresh_token').length, 1);
  assert.equal(server.signIns().length, 2);
  assert.equal(client.session.accessToken, 'access-2');
});

test('a stored session is used without signing in', async () => {
  const session = { accessToken: 'stored', expiresAt: NOW + HOUR, refreshToken: 'r', uuid: UUID };
  const server = fakeToyota();
  server.accessTokens.add('stored');
  const { client } = setup({ server, session });
  await client.vehicles();
  assert.equal(server.signIns().length, 0);
  assert.equal(server.requests.length, 1);
});

test('a bad token (403, as Toyota answers it) gets one new token and one retry', async () => {
  const { client, server, advance } = setup();
  await client.vehicles();
  server.revoke();
  advance(6 * MINUTE);
  await client.telemetry(VINS.RAV4);
  const calls = server.calls('telemetry');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers.Authorization, 'Bearer access-2');
  assert.equal(server.grants('refresh_token').length, 1);
});

test('a 401 gets one new token and one retry', async () => {
  const { client, server } = setup();
  await client.vehicles();
  server.once((r) => r.path === '/v3/telemetry', 401, missingToken());
  await client.telemetry(VINS.RAV4);
  assert.equal(server.calls('telemetry').length, 2);
  assert.equal(server.grants('refresh_token').length, 1);
});

test('a 403 right after a call the token passed is the endpoint refusing, not the token', async () => {
  const { client, server } = setup();
  await client.vehicles();
  await assert.rejects(client.location(VINS.BZ4X), {
    kind: 'forbidden',
    code: 'APIGW-403',
    detail: 'invalid guid and vin mapping',
  });
  assert.equal(server.calls('location').length, 1);
  assert.equal(server.grants('refresh_token').length, 0);
});

test('a 403 on a token not proven yet: one new token, then the refusal stands', async () => {
  const { client, server, advance } = setup();
  await client.vehicles();
  advance(6 * MINUTE);
  await assert.rejects(client.location(VINS.BZ4X), { kind: 'forbidden' });
  assert.equal(server.calls('location').length, 2);
  assert.equal(server.grants('refresh_token').length, 1);
  // The fresh token was refused too: the next 403 is taken as the endpoint's.
  await assert.rejects(client.health(VINS.BZ4X), { kind: 'forbidden' });
  assert.equal(server.grants('refresh_token').length, 1);
});

test('a wrong password is refused, nothing else is tried', async () => {
  const server = fakeToyota();
  server.password = 'other';
  const { client } = setup({ server });
  await assert.rejects(client.vehicles(), { kind: 'refused', status: 401 });
  assert.equal(server.signIns().length, 1);
  assert.equal(server.apiCalls().length, 0);
});

test('an unknown e-mail is refused ("User Not Found")', async () => {
  const server = fakeToyota();
  server.email = 'someone@else.com';
  const { client } = setup({ server });
  await assert.rejects(client.vehicles(), { kind: 'refused', message: 'unknown e-mail' });
});

test('a sign-in that changed shape fails as such, not as a wrong password', async () => {
  const server = fakeToyota();
  server.once((r) => r.url === AUTH.authenticateUrl, 200, { something: 'else' });
  const { client } = setup({ server });
  await assert.rejects(client.vehicles(), { kind: 'login_failed' });

  const second = fakeToyota();
  second.once((r) => r.url === AUTH.authorizeUrl, 200, '<html>');
  await assert.rejects(setup({ server: second }).client.vehicles(), { kind: 'login_failed' });

  const third = fakeToyota();
  third.once((r) => r.url === AUTH.authorizeUrl, 302, '', {
    location: 'com.toyota.oneapp:/x?error=1',
  });
  await assert.rejects(setup({ server: third }).client.vehicles(), {
    kind: 'login_failed',
    message: 'no authorization code',
  });

  const fourth = fakeToyota();
  fourth.once((r) => r.url === AUTH.tokenUrl, 200, { access_token: 'a', id_token: 'x.e30.y' });
  await assert.rejects(setup({ server: fourth }).client.vehicles(), { kind: 'login_failed' });
});

test('a sign-in answered 429 or 5xx', async () => {
  const server = fakeToyota();
  server.once((r) => r.url === AUTH.authenticateUrl, 429, '', { 'retry-after': '600' });
  await assert.rejects(setup({ server }).client.vehicles(), {
    kind: 'rate_limited',
    retryAfter: 600_000,
    login: true,
  });
  const down = fakeToyota();
  down.once((r) => r.url === AUTH.tokenUrl, 503, 'busy');
  await assert.rejects(setup({ server: down }).client.vehicles(), { kind: 'unavailable' });
});

test('API errors keep their status and response code', async () => {
  const { client, server } = setup();
  await assert.rejects(client.location(VINS.BZ4X), {
    kind: 'forbidden',
    status: 403,
    code: 'APIGW-403',
  });
  server.once((r) => r.path === '/v3/telemetry', 429, '', { 'retry-after': '120' });
  await assert.rejects(client.telemetry(VINS.RAV4), { kind: 'rate_limited', retryAfter: 120_000 });
  server.once((r) => r.path === '/v3/telemetry', 500, {
    status: { messages: [{ responseCode: 'ONE-GLOBAL-RS-40000' }] },
  });
  await assert.rejects(client.telemetry(VINS.RAV4), {
    kind: 'unavailable',
    code: 'ONE-GLOBAL-RS-40000',
  });
  server.once((r) => r.path === '/v3/telemetry', 200, 'not json');
  await assert.rejects(client.telemetry(VINS.RAV4), { kind: 'bad_response' });
});

test('no credentials: no request at all', async () => {
  const server = fakeToyota();
  const client = new ToyotaClient({ transport: server.transport, requestGap: 0 });
  client.configure({ email: '', password: '' });
  assert.equal(client.hasCredentials, false);
  await assert.rejects(client.vehicles(), { kind: 'no_credentials' });
  assert.equal(server.requests.length, 0);
});

test('API calls go one at a time, with a gap between them', async () => {
  const { client, server, sleeps } = setup({ gap: 1500 });
  await Promise.all([
    client.telemetry(VINS.RAV4),
    client.electric(VINS.RAV4),
    client.status(VINS.RAV4),
  ]);
  assert.equal(server.apiCalls().length, 3);
  assert.deepEqual(sleeps, [1500, 1500], 'none before the first call');
  // A failed call still counts for the gap.
  server.once((r) => r.path === '/v1/location', 500, '');
  await assert.rejects(client.location(VINS.RAV4));
  await client.health(VINS.RAV4);
  assert.deepEqual(sleeps, [1500, 1500, 1500, 1500]);
});

test('a sign-in for an old account never overwrites the new one', async () => {
  const { client, server } = setup();
  const pending = client.authenticate();
  client.configure({ email: 'new@example.com', password: 'x' });
  await pending;
  assert.equal(client.session, null);
  // The sign-in in progress kept its own credentials to the end.
  const user = server.requests[2].json.callbacks.find((c) => c.output[0].value === 'User Name');
  assert.equal(user.input[0].value, EMAIL);
});
