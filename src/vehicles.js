// -----------------------------------------------------------------------------
// The answers of the API -> plain objects (pure). Every reader accepts a
// missing or partial payload: Toyota leaves out what a model does not report.
//
// Field names and rules are pytoyoda's (models/endpoints/*.py, models/*.py):
// capabilities, fuel types, units, the remainingChargeTime placeholder.
// Distances are turned into kilometres.
// -----------------------------------------------------------------------------

import { CHARGING, FUEL_TYPES, LIMITS } from './constants.js';

const MILE = 1.609344;

const finite = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
};

const text = (value) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/** A date string -> ms, undefined when absent or invalid. */
const time = (value) => {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isNaN(ms) ? undefined : ms;
};

/** `{ value, unit }` -> kilometres ("mi" converted), undefined without both. */
export function kilometres(distance) {
  const value = finite(distance?.value);
  const unit = text(distance?.unit)?.toLowerCase();
  if (value === undefined || !unit) {
    return undefined;
  }
  if (unit === 'km') {
    return value;
  }
  return unit === 'mi' || unit === 'mile' || unit === 'miles' ? value * MILE : undefined;
}

const percent = (value) => {
  const n = finite(value);
  return n === undefined || n < 0 || n > 100 ? undefined : n;
};

const payloadOf = (answer) =>
  answer && typeof answer === 'object' && answer.payload && typeof answer.payload === 'object'
    ? answer.payload
    : undefined;

/** The kind of vehicle: `ev`, `phev`, `hybrid` or `fuel` (pytoyoda VehicleType). */
export function vehicleKind({ fuelType, evVehicle } = {}) {
  if (fuelType === FUEL_TYPES.ELECTRIC) {
    return 'ev';
  }
  if (fuelType === FUEL_TYPES.PLUG_IN) {
    return 'phev';
  }
  if (fuelType === FUEL_TYPES.HYBRID) {
    return 'hybrid';
  }
  return evVehicle === true ? 'ev' : 'fuel';
}

/**
 * GET /v2/vehicle/guid -> [{ vin, nickname, model, brand, kind, capabilities }].
 * Capabilities as pytoyoda's Vehicle decides which endpoint to read.
 */
export function readVehicles(answer) {
  const list = Array.isArray(answer?.payload) ? answer.payload : [];
  const vehicles = [];
  const seen = new Set();
  for (const raw of list) {
    const vin = text(raw?.vin);
    if (!vin || seen.has(vin)) {
      continue;
    }
    seen.add(vin);
    const extended = raw.extendedCapabilities ?? {};
    const features = raw.features ?? {};
    const fuelType = text(raw.fuelType);
    const kind = vehicleKind({ fuelType, evVehicle: raw.evVehicle });
    vehicles.push({
      vin,
      nickname: text(raw.nickName),
      model: text(raw.modelName) ?? text(raw.carlineName) ?? text(raw.displayModelDescription),
      description: text(raw.displayModelDescription),
      brand: text(raw.brand) === 'L' ? 'L' : 'T',
      kind,
      capabilities: {
        telemetry: extended.telemetryCapable === true,
        electric:
          extended.econnectVehicleStatusCapable === true ||
          raw.evVehicle === true ||
          kind === 'ev' ||
          kind === 'phev',
        status: extended.vehicleStatus === true,
        bonnet: extended.bonnetStatus === true,
        location: extended.lastParkedCapable === true || features.lastParked === true,
      },
    });
  }
  return vehicles;
}

/** GET /v3/telemetry -> { fuelLevel, batteryLevel, odometer, distanceToEmpty, charging, at }. */
export function readTelemetry(answer) {
  const p = payloadOf(answer);
  if (!p) {
    return undefined;
  }
  const odometer = kilometres(p.odometer);
  return {
    fuelLevel: percent(p.fuelLevel),
    batteryLevel: percent(p.batteryLevel),
    // An odometer of 0 is a car that did not report it (Stellantis does the same filter).
    odometer: odometer > 0 ? odometer : undefined,
    distanceToEmpty: kilometres(p.distanceToEmpty),
    charging: text(p.chargingStatus)?.toLowerCase(),
    at: time(p.timestamp),
  };
}

/** GET /v1/vehicle/electric/status -> battery, ranges, charging, remaining minutes. */
export function readElectric(answer) {
  const p = payloadOf(answer);
  if (!p) {
    return undefined;
  }
  const charging = text(p.chargingStatus)?.toLowerCase();
  let remaining = finite(p.remainingChargeTime);
  if (
    remaining !== undefined &&
    (remaining < 0 || (remaining > LIMITS.chargeMinutes && charging !== CHARGING.CHARGING))
  ) {
    // 65535 (or close) when not charging: a placeholder, not a countdown (pytoyoda).
    remaining = undefined;
  }
  return {
    batteryLevel: percent(p.batteryLevel),
    usableBatteryLevel: percent(p.phevUsableBatteryLevel),
    fuelLevel: percent(p.fuelLevel),
    evRange: kilometres(p.evRange),
    evRangeWithAc: kilometres(p.evRangeWithAc),
    fuelRange: kilometres(p.fuelRange),
    charging,
    remainingMinutes: remaining,
    at: time(p.lastUpdateTimestamp),
  };
}

const DOORS = ['driver', 'passenger', 'rearLeft', 'rearRight'];
const WINDOWS = ['driver', 'passenger', 'rearLeft', 'rearRight'];

/** "open" / "close(d)" -> true / false, undefined otherwise. */
const isOpen = (state) => {
  const value = text(state?.status)?.toLowerCase();
  if (value === 'open') {
    return true;
  }
  return value === 'close' || value === 'closed' ? false : undefined;
};

/** "locked" / "unlocked" -> true / false, undefined otherwise. */
const isLocked = (state) => {
  const value = text(state?.status)?.toLowerCase();
  if (value === 'locked') {
    return true;
  }
  return value === 'unlocked' ? false : undefined;
};

/** Any true -> true; all known false -> false; nothing known -> undefined. */
const any = (values) => {
  const known = values.filter((v) => v !== undefined);
  return known.length === 0 ? undefined : known.some(Boolean);
};

/**
 * GET /v1/vehicle/status (since July 2026, typed per component) -> locked (every
 * reported lock locked), doors, boot, bonnet and windows open, when reported.
 */
export function readStatus(answer) {
  const p = payloadOf(answer);
  if (!p) {
    return undefined;
  }
  const doors = p.doors ?? {};
  const windows = p.windows ?? {};
  const locks = [...DOORS, 'rearBack'].map((key) => isLocked(doors[key]?.lockStatus));
  const knownLocks = locks.filter((v) => v !== undefined);
  return {
    locked: knownLocks.length === 0 ? undefined : knownLocks.every(Boolean),
    doorOpen: any(DOORS.map((key) => isOpen(doors[key]?.openStatus))),
    bootOpen: isOpen(doors.rearBack?.openStatus),
    bonnetOpen: isOpen(doors.hood?.openStatus),
    windowOpen: any(WINDOWS.map((key) => isOpen(windows[key]))),
    at: time(p.lastUpdateTimestamp),
  };
}

/** GET /v1/location -> { latitude, longitude, at }, undefined without a usable position. */
export function readLocation(answer) {
  const where = payloadOf(answer)?.vehicleLocation;
  const latitude = finite(where?.latitude);
  const longitude = finite(where?.longitude);
  if (
    latitude === undefined ||
    longitude === undefined ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180 ||
    (latitude === 0 && longitude === 0)
  ) {
    return undefined;
  }
  return {
    latitude,
    longitude,
    at: time(where.locationAcquisitionDatetime) ?? time(payloadOf(answer).lastTimestamp),
  };
}

/** GET /v1/vehiclehealth/status -> { warnings: the number of dashboard warning lights }. */
export function readHealth(answer) {
  const p = payloadOf(answer);
  if (!p) {
    return undefined;
  }
  return {
    warnings: Array.isArray(p.warning) ? p.warning.length : 0,
    at: time(p.wnglastUpdTime),
  };
}

/**
 * GET /v1/trips (newest first, `limit` 1) -> the last trip, null when the
 * period has none. Lengths are metres, durations seconds, fuel millilitres.
 */
export function readLastTrip(answer) {
  const p = payloadOf(answer);
  if (!p) {
    return undefined;
  }
  const raw = Array.isArray(p.trips) ? p.trips[0] : undefined;
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const s = raw.summary ?? {};
  const metres = finite(s.length);
  const seconds = finite(s.duration);
  const millilitres = finite(s.fuelConsumption);
  const evMetres = finite(raw.hdc?.evDistance);
  const distance = metres !== undefined && metres >= 0 ? metres / 1000 : undefined;
  const fuel = millilitres !== undefined && millilitres >= 0 ? millilitres / 1000 : undefined;
  const endAt = time(s.endTs);
  const startAt = time(s.startTs);
  return {
    id: text(raw.id) ?? (endAt === undefined ? undefined : `end:${endAt}`),
    startAt,
    endAt,
    distance,
    minutes: seconds !== undefined && seconds >= 0 ? seconds / 60 : undefined,
    fuel,
    // L/100 km = (ml / 1000) / (m / 1000) * 100 (pytoyoda Trip.average_fuel_consumed).
    consumption: fuel !== undefined && distance > 0 ? (fuel / distance) * 100 : undefined,
    evPercent:
      evMetres !== undefined && metres > 0
        ? Math.min(100, Math.max(0, (evMetres / metres) * 100))
        : undefined,
    averageSpeed: finite(s.averageSpeed),
    score: finite(raw.scores?.global),
  };
}
