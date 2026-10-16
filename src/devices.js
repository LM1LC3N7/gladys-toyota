// -----------------------------------------------------------------------------
// The vehicles -> Gladys devices, and their readings -> states (pure).
//
// One device per vehicle, `ext:<selector>:vehicle:<VIN>` (the VIN never
// changes), as the car integrations of the store do (guim31/gladys-renault,
// -stellantis, -tesla). Its features depend on the kind of vehicle (fuel,
// hybrid, plug-in hybrid, electric) and on what the account says it can read
// (telemetry, electric status, doors and locks, last parked position); they
// are the same categories and types as those integrations, so the Gladys
// dashboard draws them the same way.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { CHARGING, GLADYS, LIMITS } from './constants.js';
import { BRAND_NAMES, FEATURE_NAMES, NONE, formatDate, tripSummary, word } from './i18n.js';

const text = { category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0, keep_history: false };
const binary = { min: 0, max: 1 };

/** The features, by role (the last part of their external id). */
export const FEATURES = {
  'fuel-level': {
    category: C.LEVEL_SENSOR,
    type: T.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
    unit: U.PERCENT,
    min: 0,
    max: 100,
  },
  'battery-level': {
    category: C.ELECTRICAL_VEHICLE_BATTERY,
    type: T.ELECTRICAL_VEHICLE_BATTERY.BATTERY_LEVEL,
    unit: U.PERCENT,
    min: 0,
    max: 100,
  },
  'electric-range': {
    category: C.ELECTRICAL_VEHICLE_BATTERY,
    type: T.ELECTRICAL_VEHICLE_BATTERY.BATTERY_RANGE_ESTIMATE,
    unit: U.KM,
    min: 0,
    max: 1000,
  },
  'fuel-range': {
    category: C.DISTANCE_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.KM,
    min: 0,
    max: 2000,
  },
  'total-range': {
    category: C.DISTANCE_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.KM,
    min: 0,
    max: 3000,
  },
  odometer: {
    category: C.ELECTRICAL_VEHICLE_STATE,
    type: T.ELECTRICAL_VEHICLE_STATE.ODOMETER,
    unit: U.KM,
    min: 0,
    max: 2_000_000,
  },
  'charging-state': {
    category: C.CHARGING_STATION,
    type: T.CHARGING_STATION.CHARGING_STATE,
    min: 0,
    max: GLADYS.CHARGING_STATE.MAX,
  },
  plugged: {
    category: C.ELECTRICAL_VEHICLE_CHARGE,
    type: T.ELECTRICAL_VEHICLE_CHARGE.PLUGGED,
    ...binary,
  },
  'charge-time-remaining': {
    category: C.DURATION,
    type: T.DURATION.INTEGER,
    unit: U.MINUTES,
    min: 0,
    max: 3000,
  },
  locked: { category: C.LOCK, type: T.LOCK.BINARY, ...binary },
  'door-open': {
    category: C.ELECTRICAL_VEHICLE_STATE,
    type: T.ELECTRICAL_VEHICLE_STATE.DOOR_OPENED,
    ...binary,
  },
  'boot-open': {
    category: C.ELECTRICAL_VEHICLE_STATE,
    type: T.ELECTRICAL_VEHICLE_STATE.DOOR_OPENED,
    ...binary,
  },
  'bonnet-open': {
    category: C.ELECTRICAL_VEHICLE_STATE,
    type: T.ELECTRICAL_VEHICLE_STATE.DOOR_OPENED,
    ...binary,
  },
  'window-open': {
    category: C.ELECTRICAL_VEHICLE_STATE,
    type: T.ELECTRICAL_VEHICLE_STATE.WINDOW_OPENED,
    ...binary,
  },
  position: { ...text },
  'warning-lights': { category: C.COUNTER_SENSOR, type: T.SENSOR.INTEGER, min: 0, max: 100 },
  'last-trip': { ...text },
  'last-trip-distance': {
    category: C.DISTANCE_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.KM,
    min: 0,
    max: 2000,
  },
  'last-trip-fuel': {
    category: C.VOLUME_SENSOR,
    type: T.VOLUME_SENSOR.DECIMAL,
    unit: U.LITER,
    min: 0,
    max: 200,
  },
  'last-update': { ...text },
};

export const vehicleIds = (gladys, vin) => gladys.externalIds('vehicle', vin);

/** The VIN and the role of a device or feature external id. */
export function parseExternalId(externalId) {
  const match = /:vehicle:([^:]+)(?::([^:]+))?$/.exec(String(externalId ?? ''));
  return match ? { vin: match[1], role: match[2] } : undefined;
}

/** The last 4 characters of a VIN: enough to tell two cars apart, never the whole VIN. */
export const vinTail = (vin) => `…${String(vin).slice(-4)}`;

/** The nickname given in the app, or "Toyota Yaris (…1234)". */
export function vehicleName(vehicle) {
  if (vehicle.nickname) {
    return vehicle.nickname;
  }
  const brand = BRAND_NAMES[vehicle.brand] ?? 'Toyota';
  const model = vehicle.model
    ? ` ${vehicle.model.replace(new RegExp(`^${brand}\\s+`, 'i'), '')}`
    : '';
  return `${brand}${model} (${vinTail(vehicle.vin)})`;
}

/** The roles of a vehicle's features, in display order. */
export function rolesOf(vehicle, { gps = false } = {}) {
  const { kind, capabilities: can } = vehicle;
  const electric = kind === 'ev' || kind === 'phev';
  const fuel = kind !== 'ev';
  const roles = [];
  if (fuel && (can.telemetry || can.electric)) {
    roles.push('fuel-level', 'fuel-range');
  }
  if (electric && can.electric) {
    roles.push('battery-level', 'electric-range');
  }
  if (kind === 'phev' && can.electric) {
    roles.push('total-range');
  }
  if (can.telemetry) {
    roles.push('odometer');
  }
  if (electric && can.electric) {
    roles.push('charging-state', 'plugged', 'charge-time-remaining');
  }
  if (can.status) {
    roles.push('locked', 'door-open', 'boot-open');
    if (can.bonnet) {
      roles.push('bonnet-open');
    }
    roles.push('window-open');
  }
  if (gps && can.location) {
    roles.push('position');
  }
  roles.push('warning-lights', 'last-trip', 'last-trip-distance');
  if (fuel) {
    roles.push('last-trip-fuel');
  }
  roles.push('last-update');
  return roles;
}

function feature(ids, role, language) {
  return {
    name: word(FEATURE_NAMES[role], language),
    external_id: ids.feature(role),
    read_only: true,
    has_feedback: false,
    keep_history: true,
    ...FEATURES[role],
  };
}

/** One device per vehicle (not polled by Gladys: the integration reads on its own clock). */
export function buildDevice(gladys, vehicle, { gps = false, language = 'fr' } = {}) {
  const ids = vehicleIds(gladys, vehicle.vin);
  return {
    name: vehicleName(vehicle),
    external_id: ids.device,
    model: vehicle.description ?? vehicle.model ?? BRAND_NAMES[vehicle.brand],
    should_poll: false,
    features: rolesOf(vehicle, { gps }).map((role) => feature(ids, role, language)),
  };
}

export const buildDevices = (gladys, vehicles, options) =>
  vehicles.map((vehicle) => buildDevice(gladys, vehicle, options));

const bit = (value) => (value === undefined ? undefined : value ? 1 : 0);
const round = (value, digits = 1) =>
  value === undefined ? undefined : Math.round(value * 10 ** digits) / 10 ** digits;

/** charging -> 0, plugged -> 1 (vehicle connected), complete or none -> 4 (idle), as gladys-tesla. */
export function chargingState(raw) {
  switch (raw) {
    case CHARGING.CHARGING:
      return GLADYS.CHARGING_STATE.CHARGING;
    case CHARGING.PLUGGED:
      return GLADYS.CHARGING_STATE.EV_CONNECTED;
    case CHARGING.COMPLETE:
    case CHARGING.NONE:
      return GLADYS.CHARGING_STATE.IDLE;
    default:
      return undefined;
  }
}

/** Whether the cable is in: charging, plugged or complete -> 1, none -> 0. */
export function pluggedState(raw) {
  if (raw === CHARGING.NONE) {
    return 0;
  }
  return [CHARGING.CHARGING, CHARGING.PLUGGED, CHARGING.COMPLETE].includes(raw) ? 1 : undefined;
}

/**
 * Every value a vehicle's readings give, by role (pytoyoda Dashboard rules:
 * the electric status first, the telemetry otherwise; the total range of a
 * plug-in hybrid is fuel + electric with the air conditioning on).
 */
export function valuesOf(vehicle, reads = {}, { language = 'fr' } = {}) {
  const { telemetry: tel, electric: ev, status, location, health, trip } = reads;
  const fuelRange =
    ev?.fuelRange ?? (tel?.batteryLevel === undefined ? tel?.distanceToEmpty : undefined);
  const electricRange = ev?.evRange;
  const withAc = ev?.evRangeWithAc ?? electricRange;
  const charging = ev?.charging ?? tel?.charging;
  const times = [tel?.at, ev?.at, status?.at].filter((t) => t !== undefined);
  const values = {
    'fuel-level': tel?.fuelLevel ?? ev?.fuelLevel,
    'battery-level': ev?.batteryLevel ?? tel?.batteryLevel,
    'electric-range': round(electricRange),
    'fuel-range': round(fuelRange),
    'total-range':
      fuelRange === undefined && withAc === undefined
        ? round(tel?.distanceToEmpty)
        : round((fuelRange ?? 0) + (withAc ?? 0)),
    odometer: round(tel?.odometer, 0),
    'charging-state': chargingState(charging),
    plugged: pluggedState(charging),
    'charge-time-remaining':
      ev?.remainingMinutes === undefined
        ? undefined
        : Math.round(Math.min(ev.remainingMinutes, FEATURES['charge-time-remaining'].max)),
    locked:
      status?.locked === undefined ? undefined : status.locked ? GLADYS.LOCKED : GLADYS.UNLOCKED,
    'door-open': bit(status?.doorOpen),
    'boot-open': bit(status?.bootOpen),
    'bonnet-open': bit(status?.bonnetOpen),
    'window-open': bit(status?.windowOpen),
    position: location
      ? { text: `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` }
      : undefined,
    'warning-lights': health?.warnings,
    'last-trip':
      trip === undefined ? undefined : { text: trip ? tripSummary(trip, language) : NONE },
    'last-trip-distance': trip ? round(trip.distance, 2) : undefined,
    'last-trip-fuel': trip ? round(trip.fuel, 2) : undefined,
    'last-update':
      times.length === 0 ? undefined : { text: formatDate(Math.max(...times), language) },
  };
  return values;
}

/** The states of a vehicle, for the features it has: [{ device_feature_external_id, state | text }]. */
export function vehicleStates(gladys, vehicle, reads, { gps = false, language = 'fr' } = {}) {
  const ids = vehicleIds(gladys, vehicle.vin);
  const values = valuesOf(vehicle, reads, { language });
  const states = [];
  for (const role of rolesOf(vehicle, { gps })) {
    const value = values[role];
    if (value === undefined || value === null) {
      continue;
    }
    const id = ids.feature(role);
    if (typeof value === 'object') {
      states.push({
        device_feature_external_id: id,
        text: value.text.slice(0, LIMITS.eventText * 5),
      });
    } else if (Number.isFinite(value)) {
      states.push({ device_feature_external_id: id, state: value });
    }
  }
  return states;
}
