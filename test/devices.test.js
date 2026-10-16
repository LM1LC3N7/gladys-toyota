// -----------------------------------------------------------------------------
// The vehicles -> Gladys devices and states (pure).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  buildDevice,
  chargingState,
  parseExternalId,
  pluggedState,
  rolesOf,
  valuesOf,
  vehicleName,
  vehicleStates,
} from '../src/devices.js';
import {
  readElectric,
  readHealth,
  readLastTrip,
  readLocation,
  readStatus,
  readTelemetry,
  readVehicles,
} from '../src/vehicles.js';
import {
  BZ4X,
  RAV4,
  VINS,
  YARIS,
  electric,
  health,
  location,
  telemetry,
  trips,
  vehicleStatus,
  vehicles,
} from './fixtures/toyota.js';

const gladys = createFakeGladys();
const [rav4, yaris, bz4x] = readVehicles(vehicles([RAV4(), YARIS(), BZ4X()]));

const readsOf = (overrides = {}) => ({
  telemetry: readTelemetry(telemetry()),
  electric: readElectric(electric()),
  status: readStatus(vehicleStatus()),
  location: readLocation(location()),
  health: readHealth(health()),
  trip: readLastTrip(trips()),
  ...overrides,
});

test('one device per vehicle, keyed on its VIN', () => {
  const device = buildDevice(gladys, rav4);
  assert.equal(device.external_id, `ext:test-integration:vehicle:${VINS.RAV4}`);
  assert.equal(device.name, 'RAV4');
  assert.equal(device.model, '2020 Toyota RAV4 Plug-in MY21');
  assert.equal(device.should_poll, false);
  assert.equal(device.poll_frequency, undefined);
  for (const feature of device.features) {
    assert.match(feature.external_id, new RegExp(`^${device.external_id}:[a-z-]+$`));
    assert.equal(feature.read_only, true);
    assert.equal(feature.has_feedback, false);
  }
  assert.deepEqual(parseExternalId(`${device.external_id}:odometer`), {
    vin: VINS.RAV4,
    role: 'odometer',
  });
  assert.deepEqual(parseExternalId(device.external_id), { vin: VINS.RAV4, role: undefined });
  assert.equal(parseExternalId('ext:x:zone:1'), undefined);
});

test('the name: the nickname, or the brand, the model and the end of the VIN', () => {
  assert.equal(vehicleName(rav4), 'RAV4');
  assert.equal(vehicleName(yaris), 'Toyota Yaris Hybrid (…3456)');
  assert.equal(
    vehicleName({ ...yaris, brand: 'L', model: 'Lexus UX 300e' }),
    'Lexus UX 300e (…3456)',
  );
  assert.equal(vehicleName({ ...yaris, model: undefined }), 'Toyota (…3456)');
});

test('the features follow the kind of vehicle and its capabilities', () => {
  assert.deepEqual(rolesOf(rav4), [
    'fuel-level',
    'fuel-range',
    'battery-level',
    'electric-range',
    'total-range',
    'odometer',
    'charging-state',
    'plugged',
    'charge-time-remaining',
    'locked',
    'door-open',
    'boot-open',
    'bonnet-open',
    'window-open',
    'warning-lights',
    'last-trip',
    'last-trip-distance',
    'last-trip-fuel',
    'last-update',
  ]);
  assert.deepEqual(rolesOf(yaris), [
    'fuel-level',
    'fuel-range',
    'odometer',
    'locked',
    'door-open',
    'boot-open',
    'window-open',
    'warning-lights',
    'last-trip',
    'last-trip-distance',
    'last-trip-fuel',
    'last-update',
  ]);
  const ev = rolesOf(bz4x);
  assert.ok(!ev.includes('fuel-level') && !ev.includes('last-trip-fuel'));
  assert.ok(ev.includes('battery-level') && ev.includes('charging-state'));
  // The position only when the user turned it on, and the car can.
  assert.ok(!rolesOf(rav4).includes('position'));
  assert.ok(rolesOf(rav4, { gps: true }).includes('position'));
  const blind = { ...yaris, capabilities: { ...yaris.capabilities, location: false } };
  assert.ok(!rolesOf(blind, { gps: true }).includes('position'));
});

test('feature names in French by default, English on demand', () => {
  const fr = buildDevice(gladys, rav4).features.find((f) => f.external_id.endsWith(':odometer'));
  const en = buildDevice(gladys, rav4, { language: 'en' }).features.find((f) =>
    f.external_id.endsWith(':odometer'),
  );
  assert.equal(fr.name, 'Kilométrage');
  assert.equal(en.name, 'Odometer');
});

test('charging state and plug, as gladys-tesla maps them', () => {
  assert.equal(chargingState('charging'), 0);
  assert.equal(chargingState('plugged'), 1);
  assert.equal(chargingState('chargecomplete'), 4);
  assert.equal(chargingState('none'), 4);
  assert.equal(chargingState('weird'), undefined);
  assert.equal(pluggedState('charging'), 1);
  assert.equal(pluggedState('chargecomplete'), 1);
  assert.equal(pluggedState('none'), 0);
  assert.equal(pluggedState(undefined), undefined);
});

test('the values of a plug-in hybrid (pytoyoda Dashboard rules)', () => {
  const values = valuesOf(rav4, readsOf(), { language: 'en' });
  assert.equal(values['fuel-level'], 99, 'telemetry first');
  assert.equal(values['battery-level'], 79);
  assert.equal(values['electric-range'], 57.3);
  assert.equal(values['fuel-range'], 302.6, 'electric fuel range, miles -> km');
  assert.equal(values['total-range'], 357, 'fuel + electric with the air conditioning');
  assert.equal(values.odometer, 30420);
  assert.equal(values['charging-state'], 4);
  assert.equal(values.plugged, 0);
  assert.equal(values['charge-time-remaining'], undefined);
  assert.equal(values.locked, 1);
  assert.equal(values['door-open'], 0);
  assert.deepEqual(values.position, { text: '52.16952, 0.13565' });
  assert.equal(values['warning-lights'], 0);
  assert.match(
    values['last-trip'].text,
    /15\.2 km · 14 min · 1\.5 L\/100 km · 87 % electric · score 65$/,
  );
  assert.equal(values['last-trip-distance'], 15.22);
  assert.equal(values['last-trip-fuel'], 0.23);
  assert.match(values['last-update'].text, /^16\/10\/2026, \d\d:00$/);
});

test('a hybrid without electric status takes its fuel range from the telemetry', () => {
  const values = valuesOf(yaris, readsOf({ electric: undefined }));
  assert.equal(values['fuel-range'], 634);
  assert.equal(values['battery-level'], undefined);
});

test('the trip summary in French, and a period without trip', () => {
  const fr = valuesOf(rav4, readsOf(), { language: 'fr' });
  assert.match(
    fr['last-trip'].text,
    /15,2 km · 14 min · 1,5 L\/100 km · 87 % électrique · score 65$/,
  );
  const none = valuesOf(rav4, readsOf({ trip: null }));
  assert.deepEqual(none['last-trip'], { text: '—' });
  assert.equal(none['last-trip-distance'], undefined);
  assert.equal(valuesOf(rav4, readsOf({ trip: undefined }))['last-trip'], undefined);
});

test('states only for the features the vehicle has, and only known values', () => {
  const states = vehicleStates(gladys, yaris, {
    telemetry: readTelemetry(telemetry({ odometer: 12500 })),
    status: readStatus(vehicleStatus({ locked: false })),
  });
  const byRole = Object.fromEntries(
    states.map((s) => [s.device_feature_external_id.split(':').pop(), s.text ?? s.state]),
  );
  assert.deepEqual(Object.keys(byRole), [
    'fuel-level',
    'fuel-range',
    'odometer',
    'locked',
    'door-open',
    'boot-open',
    'window-open',
    'last-update',
  ]);
  assert.equal(byRole.locked, 0);
  assert.equal(byRole.odometer, 12500);
  // No battery for a hybrid, no position without the option.
  const all = vehicleStates(gladys, yaris, readsOf());
  assert.ok(!all.some((s) => /:(battery-level|position)$/.test(s.device_feature_external_id)));
});

test('charge time remaining capped to the feature maximum', () => {
  const reads = readsOf({
    electric: readElectric(electric({ chargingStatus: 'charging', remainingChargeTime: 9000 })),
  });
  assert.equal(valuesOf(rav4, reads)['charge-time-remaining'], 3000);
  assert.equal(valuesOf(rav4, reads)['charging-state'], 0);
  assert.equal(valuesOf(rav4, reads).plugged, 1);
});
