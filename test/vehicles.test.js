// -----------------------------------------------------------------------------
// The answers of the API -> plain objects, on the pytoyoda fixtures.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  kilometres,
  readElectric,
  readHealth,
  readLastTrip,
  readLocation,
  readStatus,
  readTelemetry,
  readVehicles,
  vehicleKind,
} from '../src/vehicles.js';
import {
  BZ4X,
  NOW,
  HOUR,
  RAV4,
  VINS,
  YARIS,
  electric,
  health,
  location,
  telemetry,
  trip,
  trips,
  vehicleStatus,
  vehicles,
} from './fixtures/toyota.js';

test('the kind of vehicle follows the fuel type, as pytoyoda', () => {
  assert.equal(vehicleKind({ fuelType: 'E' }), 'ev');
  assert.equal(vehicleKind({ fuelType: 'I' }), 'phev');
  assert.equal(vehicleKind({ fuelType: 'B' }), 'hybrid');
  assert.equal(vehicleKind({ fuelType: 'G' }), 'fuel');
  assert.equal(vehicleKind({}), 'fuel');
  // A Suzuki-built BEV may report no fuel type but evVehicle (pytoyoda#312).
  assert.equal(vehicleKind({ evVehicle: true }), 'ev');
});

test('the vehicle list: VIN, names, kind and capabilities', () => {
  const list = readVehicles(vehicles([RAV4(), YARIS(), BZ4X(), { vin: '' }, RAV4()]));
  assert.deepEqual(
    list.map((v) => [v.vin, v.nickname, v.kind]),
    [
      [VINS.RAV4, 'RAV4', 'phev'],
      [VINS.YARIS, undefined, 'hybrid'],
      [VINS.BZ4X, 'bZ', 'ev'],
    ],
  );
  assert.deepEqual(list[0].capabilities, {
    telemetry: true,
    electric: true,
    status: true,
    bonnet: true,
    location: true,
  });
  // The Yaris says lastParked in `features`, not in the extended capabilities.
  assert.deepEqual(list[1].capabilities, {
    telemetry: true,
    electric: false,
    status: true,
    bonnet: false,
    location: true,
  });
  assert.equal(list[0].description, '2020 Toyota RAV4 Plug-in MY21');
  assert.equal(list[1].model, 'Yaris Hybrid');
  assert.deepEqual(readVehicles({}), []);
  assert.deepEqual(readVehicles({ payload: 'nope' }), []);
});

test('distances in km, miles converted', () => {
  assert.equal(kilometres({ value: 634, unit: 'km' }), 634);
  assert.ok(Math.abs(kilometres({ value: 188, unit: 'mi' }) - 302.556672) < 1e-6);
  assert.equal(kilometres({ value: '12', unit: 'KM' }), 12);
  assert.equal(kilometres({ value: 1, unit: 'furlong' }), undefined);
  assert.equal(kilometres({ value: null, unit: 'km' }), undefined);
  assert.equal(kilometres(undefined), undefined);
});

test('telemetry: fuel, odometer, distance to empty, time', () => {
  assert.deepEqual(readTelemetry(telemetry()), {
    fuelLevel: 99,
    batteryLevel: undefined,
    odometer: 30420,
    distanceToEmpty: 634,
    charging: undefined,
    at: NOW - HOUR,
  });
  // An odometer of 0 or a level out of 0-100 is not a reading.
  const odd = telemetry({ odometer: 0, fuelLevel: 140 });
  assert.equal(readTelemetry(odd).odometer, undefined);
  assert.equal(readTelemetry(odd).fuelLevel, undefined);
  assert.equal(readTelemetry({ status: 'SUCCESS' }), undefined);
});

test('electric status: battery, ranges, charging and the 65535 placeholder', () => {
  const read = readElectric(electric());
  assert.equal(read.batteryLevel, 79);
  assert.equal(read.usableBatteryLevel, 74);
  assert.equal(read.evRange, 57.3);
  assert.equal(read.charging, 'none');
  assert.ok(Math.abs(read.fuelRange - 302.556672) < 1e-6, 'the recorded fuel range is in miles');
  assert.equal(read.remainingMinutes, undefined);
  assert.equal(readElectric(electric({ remainingChargeTime: 65535 })).remainingMinutes, undefined);
  assert.equal(
    readElectric(electric({ chargingStatus: 'charging', remainingChargeTime: 95 }))
      .remainingMinutes,
    95,
  );
  // Charging for real with a very slow charger: trusted (pytoyoda does too).
  assert.equal(
    readElectric(electric({ chargingStatus: 'charging', remainingChargeTime: 2000 }))
      .remainingMinutes,
    2000,
  );
  assert.equal(
    readElectric(electric({ chargingStatus: 'chargeComplete' })).charging,
    'chargecomplete',
  );
});

test('vehicle status: locks, doors, boot, bonnet, windows', () => {
  assert.deepEqual(readStatus(vehicleStatus()), {
    locked: true,
    doorOpen: false,
    bootOpen: false,
    bonnetOpen: false,
    windowOpen: false,
    at: NOW - HOUR,
  });
  const open = readStatus(
    vehicleStatus({
      locked: false,
      doorOpen: true,
      bootOpen: true,
      bonnetOpen: true,
      windowOpen: true,
    }),
  );
  assert.deepEqual(
    [open.locked, open.doorOpen, open.bootOpen, open.bonnetOpen, open.windowOpen],
    [false, true, true, true, true],
  );
  // One door unlocked is enough to be unlocked.
  const answer = vehicleStatus();
  answer.payload.doors.rearBack.lockStatus.status = 'unlocked';
  assert.equal(readStatus(answer).locked, false);
  // Nothing reported (a car without the sensors): unknown, not closed.
  assert.deepEqual(readStatus({ payload: { doors: {}, windows: {} } }), {
    locked: undefined,
    doorOpen: undefined,
    bootOpen: undefined,
    bonnetOpen: undefined,
    windowOpen: undefined,
    at: undefined,
  });
});

test('location: a usable position only', () => {
  assert.deepEqual(readLocation(location()), {
    latitude: 52.169516,
    longitude: 0.135654,
    at: Date.parse('2026-10-16T07:42:41Z'),
  });
  assert.equal(readLocation(location({ latitude: 0, longitude: 0 })), undefined);
  assert.equal(readLocation(location({ latitude: 91, longitude: 0 })), undefined);
  assert.equal(readLocation({ payload: {} }), undefined);
});

test('health: the number of warning lights', () => {
  assert.equal(readHealth(health()).warnings, 0);
  assert.equal(readHealth(health({ warnings: [{ code: 'A' }, { code: 'B' }] })).warnings, 2);
  assert.equal(readHealth({}), undefined);
});

test('last trip: distance, duration, fuel, consumption, electric share, score', () => {
  const read = readLastTrip(trips());
  assert.equal(read.id, 'ffe77c0a-0b33-4496-971a-c767fbd7aba5');
  assert.equal(read.distance, 15.215);
  assert.ok(Math.abs(read.minutes - 838 / 60) < 1e-9);
  assert.equal(read.fuel, 0.226);
  assert.ok(Math.abs(read.consumption - 1.4854) < 1e-3, 'pytoyoda: 1.485 L/100 km');
  assert.ok(Math.abs(read.evPercent - (13170 / 15215) * 100) < 1e-9);
  assert.equal(read.score, 65);
  assert.equal(read.endAt, NOW - 2 * HOUR);
  assert.equal(readLastTrip(trips([])), null, 'no trip in the period');
  assert.equal(readLastTrip({}), undefined, 'no answer');
  // An electric car's trip: no fuel, no consumption.
  const ev = readLastTrip(trips([trip({ fuelConsumption: 0, evDistance: 15215 })]));
  assert.equal(ev.fuel, 0);
  assert.equal(ev.consumption, 0);
  assert.equal(ev.evPercent, 100);
});
