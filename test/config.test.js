// The configuration normalized: defaults, bounds, brand, account key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, accountKey, normalizeConfig } from '../src/config.js';
import { POLL_INTERVAL } from '../src/constants.js';
import { normalizeMemory } from '../src/store.js';

test('the defaults', () => {
  assert.deepEqual(normalizeConfig(), {
    email: '',
    password: '',
    brand: 'T',
    account: '',
    pollInterval: POLL_INTERVAL.default,
    gps: false,
    language: 'fr',
  });
  assert.equal(DEFAULTS.poll_interval, 900);
});

test('values trimmed, bounded and checked', () => {
  const config = normalizeConfig({
    email: '  Driver@Example.com ',
    password: ' spaces kept ',
    brand: 'LEXUS',
    poll_interval: '60',
    gps: 'true',
    language: 'EN',
  });
  assert.equal(config.email, 'Driver@Example.com');
  assert.equal(config.password, ' spaces kept ');
  assert.equal(config.brand, 'L');
  assert.equal(config.pollInterval, 300, 'never faster than 5 minutes');
  assert.equal(config.gps, true);
  assert.equal(config.language, 'en');
  assert.equal(normalizeConfig({ poll_interval: 999_999 }).pollInterval, 86_400);
  assert.equal(normalizeConfig({ poll_interval: 'soon' }).pollInterval, 900);
  assert.equal(normalizeConfig({ brand: 'subaru' }).brand, 'T');
  assert.equal(normalizeConfig({ language: 'de' }).language, 'fr');
  assert.equal(normalizeConfig({ gps: false }).gps, false);
  assert.equal(normalizeConfig({ gps: 1 }).gps, true);
});

test('the account key: a hash of the e-mail and the brand, never the e-mail', () => {
  const key = accountKey('driver@example.com', 'T');
  assert.match(key, /^[0-9a-f]{16}$/);
  assert.equal(accountKey(' DRIVER@example.com ', 'T'), key);
  assert.notEqual(accountKey('driver@example.com', 'L'), key);
  assert.equal(normalizeConfig({ email: 'driver@example.com' }).account, key);
});

test('the stored session, repaired', () => {
  assert.deepEqual(normalizeMemory(null), { session: null });
  assert.deepEqual(normalizeMemory({ session: { account: 'a', accessToken: 't' } }), {
    session: null,
  });
  assert.deepEqual(
    normalizeMemory({ session: { account: 'a', refreshToken: 'r', uuid: 'u', expiresAt: 'x' } }),
    { session: { account: 'a', accessToken: null, expiresAt: 0, refreshToken: 'r', uuid: 'u' } },
  );
});
