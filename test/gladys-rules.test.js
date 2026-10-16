// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device the fixtures give (plug-in
// hybrid, hybrid, electric), with and without the position, in both
// languages, then once created: Gladys accepts every state.
//
// test/fixtures/gladys-feature-table.json is the table extracted from the
// Gladys core by guim31/gladys-renault (Apache-2.0, its `source` field says
// which core commit): a category/type couple missing there shows as
// "undefined" or without icon in Gladys, a unit outside the list of its
// category is refused, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { buildDevices, vehicleStates } from '../src/devices.js';
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
  YARIS,
  electric,
  health,
  location,
  telemetry,
  trips,
  vehicleStatus,
  vehicles,
} from './fixtures/toyota.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const list = readVehicles(vehicles([RAV4(), YARIS(), BZ4X()]));
const reads = {
  telemetry: readTelemetry(telemetry()),
  electric: readElectric(electric({ chargingStatus: 'charging', remainingChargeTime: 95 })),
  status: readStatus(vehicleStatus()),
  location: readLocation(location()),
  health: readHealth(health()),
  trip: readLastTrip(trips()),
};

const scenarios = [
  { label: 'default configuration (French names)', options: {} },
  { label: 'position on, English names', options: { gps: true, language: 'en' } },
];

for (const { label, options } of scenarios) {
  test(`every discovered device follows the Gladys rules (${label})`, async () => {
    const gladys = createFakeGladys();
    const devices = buildDevices(gladys, list, options);
    assert.equal(devices.length, 3);
    for (const device of devices) {
      const where = device.name;
      assert.notEqual(device.should_poll, true, `${where}: read on the integration's own clock`);
      assert.equal(device.poll_frequency, undefined);
      assert.ok(device.features.length > 0, `${where}: no feature`);
      const externalIds = new Set();
      const names = new Set();
      for (const feature of device.features) {
        const at = `${where} / ${feature.name}`;
        const pair = table.pairs[`${feature.category}/${feature.type}`];
        assert.ok(pair, `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`);
        assert.ok(
          pair.label_en && pair.label_fr && pair.icon,
          `${at}: couple without label or icon`,
        );
        assert.ok(Number.isFinite(feature.min) && Number.isFinite(feature.max), `${at}: min/max`);
        assert.ok(feature.min <= feature.max, `${at}: min > max`);
        assert.equal(typeof feature.read_only, 'boolean');
        assert.equal(typeof feature.has_feedback, 'boolean');
        if (feature.unit !== undefined) {
          assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          const allowed = table.units_by_category[feature.category];
          if (allowed) {
            assert.ok(
              allowed.includes(feature.unit),
              `${at}: ${feature.unit} unknown to ${feature.category}`,
            );
          }
        }
        if (feature.category === 'text') {
          assert.equal(feature.max, 0, `${at}: a text feature needs max 0`);
        }
        assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
        externalIds.add(feature.external_id);
        assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
        names.add(feature.name);
      }
    }

    // The user adds them all: Gladys accepts every state (the fake refuses
    // what the core refuses).
    await gladys.connect();
    for (const device of devices) {
      await gladys.fake.deviceCreated(device);
    }
    for (const vehicle of list) {
      const states = vehicleStates(gladys, vehicle, reads, options);
      for (const state of states) {
        const feature = devices
          .flatMap((d) => d.features)
          .find((f) => f.external_id === state.device_feature_external_id);
        if ('state' in state) {
          assert.ok(
            state.state >= feature.min && state.state <= feature.max,
            `${feature.name}: ${state.state} outside ${feature.min}-${feature.max}`,
          );
        }
      }
      await gladys.publishStates(states);
    }
    const refused = gladys.fake.requests.filter((r) => r.path === '/state' && r.status !== 200);
    assert.deepEqual(refused, []);
    assert.ok(gladys.fake.states.length > 40);
    await gladys.disconnect();
  });
}
