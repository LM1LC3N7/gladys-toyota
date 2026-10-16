// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys and the fake MyToyota behind the transport. Timers and Date are
// mocked: the tests move the clock second by second, like the scheduler
// sees it.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ToyotaApp } from '../src/app.js';
import { accountKey } from '../src/config.js';
import { ACTIONS, AUTH, SCENE_ACTIONS, SCENE_TRIGGERS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import {
  EMAIL,
  HOUR,
  MINUTE,
  NOW,
  PASSWORD,
  UUID,
  VINS,
  health,
  telemetry,
  trip,
  trips,
} from './fixtures/toyota.js';
import { fakeToyota, memoryStore, settle } from './helpers/fakeToyota.js';

const CONFIG = { email: EMAIL, password: PASSWORD };
const car = (vin) => `ext:test-integration:vehicle:${vin}`;
const RAV4 = car(VINS.RAV4);
const YARIS = car(VINS.YARIS);

async function setup(t, { config = CONFIG, store = memoryStore(), server = fakeToyota() } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const gladys = createFakeGladys({ config });
  const app = new ToyotaApp({
    gladys,
    logger: createLogger({ level: 'silent' }),
    transport: server.transport,
    now: () => Date.now(),
    requestGap: 0,
    store,
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const advance = async (ms) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
      t.mock.timers.tick(1000);
      await settle();
    }
  };
  return { gladys, app, server, store, advance };
}

const deviceOf = (gladys, id) => gladys.fake.discoveredDevices.find((d) => d.external_id === id);
const create = async (gladys, ...ids) => {
  for (const id of ids) {
    await gladys.fake.deviceCreated(deviceOf(gladys, id));
  }
  await settle();
};
const createAll = (gladys) =>
  create(gladys, ...gladys.fake.discoveredDevices.map((d) => d.external_id));
const last = (gladys, id, role) => gladys.fake.lastState(`${id}:${role}`);
const endpoints = (server) =>
  server
    .apiCalls()
    .map((r) => `${r.path.replace(/^\/v\d\//, '')} ${r.headers.vin?.slice(-4) ?? ''}`.trim());

test('without credentials, the status asks for them and nothing is requested', async (t) => {
  const { gladys, server } = await setup(t, { config: {} });
  assert.equal(server.requests.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /e-mail and password/);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.fr, /e-mail et le mot de passe/);
});

test('one sign-in, the vehicles, then each one read endpoint by endpoint', async (t) => {
  const { gladys, server, store } = await setup(t);
  assert.equal(server.signIns().length, 1);
  assert.deepEqual(endpoints(server), [
    'vehicle/guid',
    'telemetry 9752',
    'vehicle/electric/status 9752',
    'vehicle/status 9752',
    'vehiclehealth/status 9752',
    'trips 9752',
    'telemetry 3456',
    'vehicle/status 3456',
    'vehiclehealth/status 3456',
    'trips 3456',
  ]);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => [d.external_id, d.name]),
    [
      [RAV4, 'RAV4'],
      [YARIS, 'Toyota Yaris Hybrid (…3456)'],
    ],
  );
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: true,
    message: {
      en: 'Connected to MyToyota: 2 vehicles (RAV4, Toyota Yaris Hybrid (…3456)). Open Discovery to add them.',
      fr: 'Connecté à MyToyota : 2 véhicules (RAV4, Toyota Yaris Hybrid (…3456)). Ouvrez Découverte pour les ajouter.',
    },
  });
  assert.deepEqual(store.data.session, {
    account: accountKey(EMAIL, 'T'),
    accessToken: 'access-1',
    expiresAt: NOW + 3599 * 1000,
    refreshToken: 'refresh-1',
    uuid: UUID,
  });
  // Nothing published before the user adds the devices.
  assert.equal(gladys.fake.states.length, 0);
});

test('the states of the created devices, and their cloud badges', async (t) => {
  const { gladys } = await setup(t);
  await createAll(gladys);
  assert.equal(last(gladys, RAV4, 'fuel-level'), 99);
  assert.equal(last(gladys, RAV4, 'battery-level'), 79);
  assert.equal(last(gladys, RAV4, 'electric-range'), 57.3);
  assert.equal(last(gladys, RAV4, 'total-range'), 357);
  assert.equal(last(gladys, RAV4, 'odometer'), 30420);
  assert.equal(last(gladys, RAV4, 'charging-state'), 4);
  assert.equal(last(gladys, RAV4, 'plugged'), 0);
  assert.equal(last(gladys, RAV4, 'locked'), 1);
  assert.equal(last(gladys, RAV4, 'bonnet-open'), 0);
  assert.equal(last(gladys, RAV4, 'warning-lights'), 0);
  assert.match(String(last(gladys, RAV4, 'last-trip')), /15,2 km · 14 min/);
  assert.equal(last(gladys, YARIS, 'locked'), 0);
  assert.equal(last(gladys, YARIS, 'fuel-level'), 63);
  assert.equal(last(gladys, YARIS, 'last-trip'), '—');
  // The trip distance is dated at the end of the trip.
  const distance = gladys.fake.states.find(
    (s) => s.device_feature_external_id === `${RAV4}:last-trip-distance`,
  );
  assert.equal(distance.state, 15.22);
  assert.equal(distance.created_at, new Date(NOW - 2 * HOUR).toISOString());
  assert.deepEqual(
    gladys.fake.transports.map((b) => [b.device_external_id, b.transport]),
    [
      [RAV4, DEVICE_TRANSPORTS.CLOUD],
      [YARIS, DEVICE_TRANSPORTS.CLOUD],
    ],
  );
});

test('every 15 minutes the readings; the warning lights every 6 hours; trips when the odometer moves', async (t) => {
  const { gladys, server, advance } = await setup(t);
  await createAll(gladys);
  await advance(15 * MINUTE);
  assert.equal(server.calls('telemetry', VINS.RAV4).length, 2);
  assert.equal(server.calls('electric', VINS.RAV4).length, 2);
  assert.equal(server.calls('status', VINS.YARIS).length, 2);
  assert.equal(server.calls('health').length, 2, 'once per car at the start only');
  assert.equal(server.calls('trips').length, 2, 'the odometer did not move');
  assert.equal(server.calls('location').length, 0, 'the position is off by default');
  assert.equal(server.requests.filter((r) => r.url.includes('/v2/vehicle/guid')).length, 1);

  // The RAV4 drove: a new odometer, a new trip.
  server.data.telemetry[VINS.RAV4] = telemetry({ odometer: 30450 });
  server.data.trips[VINS.RAV4] = trips([
    trip({ id: 'trip-2', end: NOW + 20 * MINUTE, length: 30000, fuelConsumption: 1500 }),
  ]);
  const before = gladys.fake.states.length;
  await advance(15 * MINUTE);
  assert.equal(server.calls('trips', VINS.RAV4).length, 2);
  assert.equal(server.calls('trips', VINS.YARIS).length, 1);
  assert.deepEqual(gladys.fake.sceneEvents, [
    {
      key: SCENE_TRIGGERS.TRIP_ENDED,
      data: {
        vehicle: RAV4,
        vehicle_name: 'RAV4',
        distance_km: 30,
        duration_min: 14,
        fuel_l: 1.5,
        consumption_l_100km: 5,
        ev_percent: 44,
        score: 65,
        ended_at: new Date(NOW + 20 * MINUTE).toISOString(),
      },
    },
  ]);
  const sent = gladys.fake.states.slice(before);
  const odometer = sent.find((s) => s.device_feature_external_id === `${RAV4}:odometer`);
  assert.equal(odometer.state, 30450);
  const fuel = sent.find((s) => s.device_feature_external_id === `${RAV4}:last-trip-fuel`);
  assert.equal(fuel.state, 1.5);

  // 6 hours later: the warning lights again, and the trips of the Yaris.
  await advance(6 * HOUR);
  assert.equal(server.calls('health').length, 4);
  assert.ok(server.calls('trips', VINS.YARIS).length >= 2);
  assert.equal(gladys.fake.sceneEvents.length, 1, 'the same trip never fires twice');
});

test('the vehicle list is read again after a day', async (t) => {
  const { server, advance } = await setup(t);
  await advance(24 * HOUR);
  assert.equal(server.requests.filter((r) => r.url.includes('/v2/vehicle/guid')).length, 2);
  assert.equal(server.signIns().length, 1, 'the tokens were refreshed, not signed in again');
  assert.ok(server.grants('refresh_token').length >= 20);
});

test('an endpoint a car refuses is left aside for a day, the others go on', async (t) => {
  const server = fakeToyota();
  delete server.data.status[VINS.YARIS];
  const { gladys, advance } = await setup(t, { server });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(server.calls('status', VINS.YARIS).length, 1);
  await advance(HOUR);
  assert.equal(server.calls('status', VINS.YARIS).length, 1, 'not asked again');
  assert.equal(server.calls('status', VINS.RAV4).length, 5);
  await advance(23 * HOUR);
  assert.equal(server.calls('status', VINS.YARIS).length, 2, 'asked again after a day');
});

test('a token Toyota no longer accepts (403) is renewed, no endpoint is set aside', async (t) => {
  const { gladys, server, advance } = await setup(t);
  await createAll(gladys);
  server.revoke();
  await advance(15 * MINUTE);
  assert.equal(server.grants('refresh_token').length, 1);
  assert.equal(server.calls('telemetry', VINS.RAV4).length, 3, 'one refused, one retried');
  assert.equal(server.calls('status', VINS.YARIS).length, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  await advance(15 * MINUTE);
  assert.equal(server.calls('electric', VINS.RAV4).length, 3, 'still read');
});

test('a 5xx on one endpoint skips it for this round only', async (t) => {
  const server = fakeToyota();
  server.once((r) => r.path === '/v1/vehicle/electric/status', 500, '');
  const { gladys, advance } = await setup(t, { server });
  await createAll(gladys);
  assert.equal(last(gladys, RAV4, 'battery-level'), undefined);
  await advance(15 * MINUTE);
  assert.equal(last(gladys, RAV4, 'battery-level'), 79);
});

test('a 429 stops the round and waits (Retry-After, 30 minutes otherwise)', async (t) => {
  const server = fakeToyota();
  server.once((r) => r.path === '/v1/vehicle/electric/status', 429, '');
  const { gladys, advance } = await setup(t, { server });
  assert.deepEqual(endpoints(server), [
    'vehicle/guid',
    'telemetry 9752',
    'vehicle/electric/status 9752',
  ]);
  assert.deepEqual(gladys.fake.connectionStatus.message, {
    en: 'Toyota asks to slow down (too many requests): next read in 30 min.',
    fr: 'Toyota demande de ralentir (trop de requêtes) : prochaine lecture dans 30 min.',
  });
  const count = server.requests.length;
  await advance(29 * MINUTE);
  assert.equal(server.requests.length, count, 'nothing during the pause');
  await advance(2 * MINUTE + 15 * MINUTE);
  assert.ok(server.requests.length > count);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a wrong password is never retried on its own; the test button tries once', async (t) => {
  const server = fakeToyota();
  server.password = 'something else';
  const { gladys, advance } = await setup(t, { server });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the e-mail or password/);
  await advance(2 * HOUR);
  assert.equal(server.signIns().length, 1);
  server.password = PASSWORD;
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.equal(server.signIns().length, 2);
  assert.match(
    ack.data.message.en,
    /^Signed in\. 2 vehicles: RAV4 \(plug-in hybrid, …9752, \d+ values read\); Toyota Yaris Hybrid \(…3456\) \(hybrid, …3456, \d+ values read\)\. Read every 15 min\.$/,
  );
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a sign-in page that changed waits 6 hours and says so', async (t) => {
  const server = fakeToyota();
  server.once((r) => r.url === AUTH.authenticateUrl, 200, { unexpected: true });
  const { gladys, advance } = await setup(t, { server });
  assert.match(gladys.fake.connectionStatus.message.en, /answered unexpectedly.*6 h\./);
  await advance(5 * HOUR);
  assert.equal(server.signIns().length, 1);
  await advance(HOUR + 15 * MINUTE);
  assert.equal(server.signIns().length, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('MyToyota down: unreachable badges, backoff, then back', async (t) => {
  const { gladys, server, advance } = await setup(t);
  await createAll(gladys);
  server.down = true;
  await advance(15 * MINUTE);
  assert.deepEqual(
    gladys.fake.connectionStatus.message.en,
    'MyToyota unreachable (connection refused). Next try in 5 min.',
  );
  assert.deepEqual(
    gladys.fake.transports.slice(-2).map((b) => b.transport),
    [DEVICE_TRANSPORTS.UNREACHABLE, DEVICE_TRANSPORTS.UNREACHABLE],
  );
  server.down = false;
  await advance(15 * MINUTE);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.transports.at(-1).transport, DEVICE_TRANSPORTS.CLOUD);
});

test('a restart reuses the stored session: no new sign-in', async (t) => {
  const store = memoryStore({
    session: {
      account: accountKey(EMAIL, 'T'),
      accessToken: 'stored',
      expiresAt: NOW + HOUR,
      refreshToken: 'refresh-stored',
      uuid: UUID,
    },
  });
  const server = fakeToyota();
  server.accessTokens.add('stored');
  await setup(t, { store, server });
  assert.equal(server.signIns().length, 0);
  assert.equal(server.apiCalls()[0].headers.Authorization, 'Bearer stored');
});

test('a stored session of another account (or brand) is not used', async (t) => {
  const store = memoryStore({
    session: {
      account: accountKey(EMAIL, 'L'),
      accessToken: 'stored',
      expiresAt: NOW + HOUR,
      refreshToken: 'r',
      uuid: UUID,
    },
  });
  const { server } = await setup(t, { store });
  assert.equal(server.signIns().length, 1);
});

test('the parked position: only when turned on, forgotten when turned off', async (t) => {
  const { gladys, server } = await setup(t);
  await createAll(gladys);
  assert.ok(!deviceOf(gladys, RAV4).features.some((f) => f.external_id.endsWith(':position')));
  await gladys.fake.configUpdated({ ...CONFIG, gps: true });
  await settle();
  assert.equal(server.calls('location').length, 2);
  assert.ok(deviceOf(gladys, RAV4).features.some((f) => f.external_id.endsWith(':position')));
  await gladys.fake.deviceUpdated(deviceOf(gladys, RAV4));
  await settle();
  assert.equal(last(gladys, RAV4, 'position'), '52.16952, 0.13565');
  await gladys.fake.configUpdated({ ...CONFIG, gps: false });
  await settle();
  assert.ok(!deviceOf(gladys, RAV4).features.some((f) => f.external_id.endsWith(':position')));
  assert.equal(server.calls('location').length, 2);
});

test('a new password or brand starts again; a new interval only reschedules', async (t) => {
  const { gladys, server, advance } = await setup(t);
  await gladys.fake.configUpdated({ ...CONFIG, poll_interval: 3600 });
  await settle();
  assert.equal(server.signIns().length, 1);
  await advance(30 * MINUTE);
  assert.equal(server.calls('telemetry', VINS.RAV4).length, 1);
  await advance(30 * MINUTE);
  assert.equal(server.calls('telemetry', VINS.RAV4).length, 2);
  await gladys.fake.configUpdated({ ...CONFIG, brand: 'lexus' });
  await settle();
  assert.equal(server.signIns().length, 2);
  assert.equal(server.apiCalls().at(-1).headers['x-brand'], 'L');
});

test('the scene action reads now (one car or all), at most every two minutes', async (t) => {
  const { gladys, server, advance } = await setup(t);
  let ack = await gladys.fake.sceneAction(SCENE_ACTIONS.REFRESH, {});
  assert.equal(server.calls('telemetry').length, 2, 'just read: not again');
  assert.equal(ack.data.outputs.read_at, new Date(NOW).toISOString());
  await advance(3 * MINUTE);
  ack = await gladys.fake.sceneAction(SCENE_ACTIONS.REFRESH, { vehicle: YARIS });
  assert.equal(server.calls('telemetry', VINS.YARIS).length, 2);
  assert.equal(server.calls('telemetry', VINS.RAV4).length, 1);
  assert.equal(server.calls('health', VINS.YARIS).length, 2, 'forced: the warning lights');
  assert.equal(server.calls('trips', VINS.YARIS).length, 2, 'forced: the last trip');
  assert.equal(ack.data.outputs.read_at, new Date(NOW + 3 * MINUTE).toISOString());
  ack = await gladys.fake.sceneAction(SCENE_ACTIONS.REFRESH, { vehicle: car('UNKNOWN') });
  assert.equal(ack.success, false);
  assert.match(ack.error, /pas \(ou plus\) dans le compte MyToyota/);
});

test('warning lights and charging read as they change', async (t) => {
  const server = fakeToyota();
  const { gladys, advance } = await setup(t, { server });
  await createAll(gladys);
  server.data.health[VINS.RAV4] = health({ warnings: [{ code: 'OIL' }] });
  await gladys.fake.sceneAction(SCENE_ACTIONS.REFRESH, {});
  await advance(3 * MINUTE);
  await gladys.fake.sceneAction(SCENE_ACTIONS.REFRESH, {});
  assert.equal(last(gladys, RAV4, 'warning-lights'), 1);
});

test('the test button summarizes the account, at most every two minutes', async (t) => {
  const { gladys, server } = await setup(t, { config: { ...CONFIG, language: 'en' } });
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /^Already read less than two minutes ago/);
  assert.match(
    ack.data.message.fr,
    /2 véhicules : RAV4 \(hybride rechargeable, …9752, \d+ valeurs lues\)/,
  );
  assert.equal(server.signIns().length, 1);
});

test('a reconnection to Gladys resends the list and the status without reading MyToyota', async (t) => {
  const { gladys, app, server } = await setup(t);
  const count = server.requests.length;
  await app.connected(CONFIG);
  assert.equal(server.requests.length, count);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a Scan reads the vehicle list again, once per 10 minutes', async (t) => {
  const { gladys, server } = await setup(t);
  await gladys.fake.scanRequest();
  await settle();
  await gladys.fake.scanRequest();
  await settle();
  assert.equal(server.requests.filter((r) => r.url.includes('/v2/vehicle/guid')).length, 2);
});
