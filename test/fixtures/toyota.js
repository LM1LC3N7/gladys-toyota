// -----------------------------------------------------------------------------
// Answers of the MyToyota sign-in and of the Toyota Connected Services Europe
// API, adapted from the recorded ones of pytoyoda 6.0.0 (MIT, Simon Hansen and
// contributors): tests/unit_tests/data/*.json and
// tests/integration_tests/data/authenticate_*.json.
//
// Kept as recorded: field names, nesting, units (the electric status gives its
// fuel range in miles while the rest is in km), status blocks, the sign-in
// rounds and the id token (its payload carries `"uuid": "123456789"`).
// Changed: VINs (made up), the RAV4 PHEV of v2_vehicleguid.json also reports
// the vehicle status and the bonnet (2026 status endpoint), a Yaris hybrid and
// a bZ4X electric are added with the same shape, the trip of v1_trips.json is
// trimmed (no behaviours, no route) and dated relative to the tests.
// -----------------------------------------------------------------------------

export const EMAIL = 'driver@example.com';
export const PASSWORD = 'correct horse';
export const UUID = '123456789';
/** The id token of authenticate_working.json: {"name":"John Doe","uuid":"123456789"}. */
export const ID_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJuYW1lIjoiSm9obiBEb2UiLCJ1dWlkIjoiMTIzNDU2Nzg5In0.WRnmzTP3vOK0W_Xh2sw4OpxxqDksjeeBgx3_4y4UeZU';

export const VINS = {
  RAV4: 'JTMGBRFV80D109752',
  YARIS: 'VNKKBAC3X0A123456',
  BZ4X: 'JTMABADA0PA004321',
};

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
/** The tests start at this time (2026-10-16T08:00:00Z). */
export const NOW = Date.parse('2026-10-16T08:00:00Z');

const ok = (responseCode, description = 'Request Completed Successfully') => ({
  messages: [{ description, detailedDescription: description, responseCode }],
});

// --- Sign-in (authenticate_working.json) -------------------------------------

export const signInRounds = () => [
  {
    authId: 'REMOVED',
    callbacks: [
      {
        type: 'NameCallback',
        output: [{ name: 'prompt', value: 'Market Locale' }],
        input: [{ name: 'IDToken1', value: '' }],
        _id: 0,
      },
      {
        type: 'NameCallback',
        output: [{ name: 'prompt', value: 'Internationalization' }],
        input: [{ name: 'IDToken2', value: '' }],
        _id: 1,
      },
      {
        type: 'NameCallback',
        output: [{ name: 'prompt', value: 'UI Locales' }],
        input: [{ name: 'IDToken3', value: '' }],
        _id: 2,
      },
    ],
  },
  {
    authId: 'REMOVED',
    callbacks: [
      {
        type: 'NameCallback',
        output: [{ name: 'prompt', value: 'User Name' }],
        input: [{ name: 'IDToken1', value: '' }],
        _id: 3,
      },
      {
        type: 'ChoiceCallback',
        output: [
          { name: 'prompt', value: 'Prompt' },
          { name: 'choices', value: ['Local', 'Google', 'Facebook', 'Apple'] },
          { name: 'defaultChoice', value: 0 },
        ],
        input: [{ name: 'IDToken2', value: 0 }],
        _id: 4,
      },
    ],
  },
  {
    authId: 'REMOVED',
    callbacks: [
      {
        type: 'PasswordCallback',
        output: [{ name: 'prompt', value: 'Password' }],
        input: [{ name: 'IDToken1', value: '' }],
        _id: 5,
      },
      {
        type: 'ChoiceCallback',
        output: [
          { name: 'prompt', value: 'Prompt' },
          { name: 'choices', value: ['continue', 'resetpass'] },
          { name: 'defaultChoice', value: 0 },
        ],
        input: [{ name: 'IDToken2', value: 0 }],
        _id: 6,
      },
    ],
  },
];

export const signInDone = () => ({ tokenId: 'token-id-1', successUrl: '/console', realm: '/tme' });

/** authenticate_invalid_password.json, last round (HTTP 401). */
export const wrongPassword = () => ({
  code: 401,
  reason: 'Unauthorized',
  message: 'Login failure',
  detail: { failureUrl: 'error://passworderror' },
});

/** authenticate_invalid_username.json, last round (HTTP 200). */
export const userNotFound = () => ({
  authId: 'REMOVED',
  callbacks: [
    {
      type: 'TextOutputCallback',
      output: [
        { name: 'message', value: 'User Not Found' },
        { name: 'messageType', value: '2' },
      ],
    },
  ],
});

export const authorizeLocation = (code) =>
  `com.toyota.oneapp:/oauth2Callback?code=${code}&iss=https%3A%2F%2Fb2c-login.toyota-europe.com%2Foauth2%2Frealms%2Froot%2Frealms%2Ftme&client_id=oneapp`;

export const tokenAnswer = ({ access, refresh, lifetime = 3599, idToken = ID_TOKEN }) => ({
  access_token: access,
  refresh_token: refresh,
  scope: 'openid profile write',
  id_token: idToken,
  token_type: 'Bearer',
  expires_in: lifetime,
});

// --- Vehicles (v2_vehicleguid.json) ------------------------------------------

const capabilities = (on) =>
  Object.fromEntries(
    [
      'acScheduling',
      'batteryStatus',
      'bonnetStatus',
      'chargeManagement',
      'climateCapable',
      'doorLockUnlockCapable',
      'econnectClimateCapable',
      'econnectVehicleStatusCapable',
      'fuelLevelAvailable',
      'fuelRangeAvailable',
      'lastParkedCapable',
      'remoteEngineStartStop',
      'telemetryCapable',
      'vehicleStatus',
    ].map((key) => [key, on.includes(key)]),
  );

export const vehicleOf = ({ vin, nickName, fuelType, evVehicle, model, line, on, lastParked }) => ({
  alerts: [],
  brand: 'T',
  carlineName: line,
  color: 'Dark Blue Metallic',
  displayModelDescription: model,
  evVehicle,
  extendedCapabilities: capabilities(on),
  features: { lastParked: lastParked ?? false, serviceHistory: true, climateStartEngine: false },
  fuelType,
  generation: '17CYPLUS',
  imei: '***************',
  modelName: line,
  nickName,
  owner: true,
  region: 'EU',
  remoteDisplay: '7',
  remoteSubscriptionStatus: 'ACTIVE',
  status: 'ACTIVE',
  vin,
});

export const RAV4 = () =>
  vehicleOf({
    vin: VINS.RAV4,
    nickName: 'RAV4',
    fuelType: 'I',
    evVehicle: true,
    model: '2020 Toyota RAV4 Plug-in MY21',
    line: 'RAV4 Plug-in MY21',
    on: [
      'acScheduling',
      'bonnetStatus',
      'chargeManagement',
      'econnectClimateCapable',
      'econnectVehicleStatusCapable',
      'fuelLevelAvailable',
      'fuelRangeAvailable',
      'lastParkedCapable',
      'telemetryCapable',
      'vehicleStatus',
    ],
  });

export const YARIS = () =>
  vehicleOf({
    vin: VINS.YARIS,
    nickName: null,
    fuelType: 'B',
    evVehicle: false,
    model: '2024 Toyota Yaris Hybrid',
    line: 'Yaris Hybrid',
    on: ['fuelLevelAvailable', 'fuelRangeAvailable', 'telemetryCapable', 'vehicleStatus'],
    lastParked: true,
  });

export const BZ4X = () =>
  vehicleOf({
    vin: VINS.BZ4X,
    nickName: 'bZ',
    fuelType: 'E',
    evVehicle: true,
    model: '2023 Toyota bZ4X',
    line: 'bZ4X',
    on: ['econnectVehicleStatusCapable', 'lastParkedCapable', 'telemetryCapable', 'vehicleStatus'],
  });

export const vehicles = (list = [RAV4(), YARIS()]) => ({
  payload: list,
  status: ok('ONE-VL-10000', 'Successfully retreived all vehicles'),
});

// --- Readings ----------------------------------------------------------------

/** v3_telemetry.json (a hybrid: fuel only, no battery level). */
export const telemetry = ({
  odometer = 30420,
  fuelLevel = 99,
  dte = 634,
  at = NOW - HOUR,
} = {}) => ({
  payload: {
    fuelType: 'B',
    odometer: { value: odometer, unit: 'km' },
    fuelLevel,
    distanceToEmpty: { value: dte, unit: 'km' },
    timestamp: new Date(at).toISOString().replace('.000Z', 'Z'),
  },
  status: 'SUCCESS',
  code: 200,
  message: 'Ok',
  errors: [],
});

/** v1_global_remote_electric_status.json (now served by /v1/vehicle/electric/status). */
export const electric = ({
  batteryLevel = 79,
  chargingStatus = 'none',
  remainingChargeTime,
  at = NOW - HOUR,
} = {}) => ({
  payload: {
    batteryLevel,
    phevUsableBatteryLevel: 74,
    canSetNextChargingEvent: true,
    chargingStatus,
    evRange: { unit: 'km', value: 57.3 },
    evRangeWithAc: { unit: 'km', value: 54.434999999999995 },
    fuelLevel: 41,
    fuelRange: { unit: 'mi', value: 188.0 },
    lastUpdateTimestamp: new Date(at).toISOString().replace('.000Z', 'Z'),
    ...(remainingChargeTime === undefined ? {} : { remainingChargeTime }),
  },
  status: ok('ONE-GLOBAL-RS-10000'),
});

const component = (status, at) => ({ lastUpdateTimestamp: at, status });

/** v1_global_remote_status.json (the typed /v1/vehicle/status payload of July 2026). */
export const vehicleStatus = ({
  vin = VINS.RAV4,
  locked = true,
  doorOpen = false,
  bootOpen = false,
  bonnetOpen = false,
  windowOpen = false,
  at = NOW - HOUR,
} = {}) => {
  const ts = new Date(at).toISOString();
  const door = (open, lock = locked) => ({
    lockStatus: component(lock ? 'locked' : 'unlocked', ts),
    openStatus: component(open ? 'open' : 'close', ts),
  });
  return {
    status: {
      serviceIdentifier: 'vehicle-status-service',
      messages: [
        {
          responseCode: 'CTP-GENERIC-20001',
          description: 'Success',
          detailedDescription: 'Request successfully completed',
        },
      ],
    },
    payload: {
      vin,
      lastUpdateTimestamp: ts,
      overallStatus: 'ok',
      overallWarningCounts: 0,
      leftHandDrive: true,
      doors: {
        driver: door(doorOpen),
        passenger: door(false),
        rearLeft: door(false),
        rearRight: door(false),
        rearBack: door(bootOpen),
        hood: { openStatus: component(bonnetOpen ? 'open' : 'close', ts) },
      },
      windows: {
        driver: component(windowOpen ? 'open' : 'close', ts),
        passenger: component('close', ts),
        rearLeft: component('close', ts),
        rearRight: component('close', ts),
      },
      lights: {
        hazard: component('off', ts),
        tail: component('off', ts),
        head: component('off', ts),
      },
      rearSeatReminder: { lastUpdateTimestamp: ts, warning: false, reason: 'notDetected' },
    },
  };
};

/** v1_location_ok.json. */
export const location = ({ vin = VINS.RAV4, latitude = 52.169516, longitude = 0.135654 } = {}) => ({
  code: 200,
  errors: [],
  message: 'Ok',
  payload: {
    lastTimestamp: '2026-10-16T07:42:41Z',
    vehicleLocation: {
      displayName: 'Last Parked',
      latitude,
      locationAcquisitionDatetime: '2026-10-16T07:42:41Z',
      longitude,
    },
    vin,
  },
  status: 'SUCCESS',
});

/** v1_vehicle_health_ok.json (`warning` is a list the libraries do not decode). */
export const health = ({ vin = VINS.RAV4, warnings = [] } = {}) => ({
  code: 200,
  errors: [],
  payload: {
    quantityOfEngOilIcon: [],
    vin,
    warning: warnings,
    wnglastUpdTime: '2026-10-16T06:20:10.203Z',
  },
  status: 'SUCCESS',
});

/** v1_location_error.json / v1_vehicle_health_error.json (HTTP 403). */
export const apigw403 = () => ({
  status: {
    messages: [
      {
        description: 'Unauthorized',
        detailedDescription: 'invalid guid and vin mapping',
        responseCode: 'APIGW-403',
      },
    ],
  },
});

/**
 * What the API answers a bad token (HTTP 403) and a missing one (HTTP 401):
 * recorded against the real API on 2026-10-16, without any account.
 */
export const badToken = () => ({
  status: {
    messages: [
      {
        responseCode: 'APIGW-403',
        description: 'Unauthorized',
        detailedDescription: 'The token was expected to have 3 parts, but got 0.',
      },
    ],
  },
});

export const missingToken = () => ({
  status: {
    messages: [
      {
        responseCode: 'APIGW-401',
        description: 'Unauthorized',
        detailedDescription: 'Invalid API Key or Missing authorization Header',
      },
    ],
  },
});

/** The first trip of v1_trips.json, trimmed, ending at `end`. */
export const trip = ({
  id = 'ffe77c0a-0b33-4496-971a-c767fbd7aba5',
  end = NOW - 2 * HOUR,
  length = 15215,
  duration = 838,
  fuelConsumption = 226.0,
  evDistance = 13170,
} = {}) => ({
  category: 0,
  hdc: {
    chargeDist: 2386,
    chargeTime: 193,
    ecoDist: 11937,
    ecoTime: 579,
    evDistance,
    evTime: 653,
    powerDist: 884,
    powerTime: 55,
  },
  id,
  scores: { acceleration: 60, braking: 70, global: 65 },
  summary: {
    averageSpeed: 65.36,
    countries: ['FR'],
    duration,
    durationHighway: 0,
    durationIdle: 3,
    durationOverspeed: 57,
    endLat: 52.3447,
    endLon: 0.2163,
    endTs: new Date(end).toISOString().replace('.000Z', 'Z'),
    fuelConsumption,
    length,
    lengthHighway: 0,
    lengthOverspeed: 1334,
    maxSpeed: 0.0,
    nightTrip: false,
    startLat: 52.1,
    startLon: 0.1,
    startTs: new Date(end - duration * 1000).toISOString().replace('.000Z', 'Z'),
  },
});

/** v1_trips.json with `limit` 1 and no summary (newest first). */
export const trips = (list = [trip()]) => ({
  payload: {
    _metadata: {
      pagination: {
        currentPage: 1,
        limit: 1,
        nextOffset: list.length > 0 ? 1 : null,
        offset: 0,
        pageCount: list.length,
        previousOffset: null,
        totalCount: list.length,
      },
      sortedBy: [{ field: 'summary.start.ts', order: 'DESC' }],
    },
    from: '2026-07-18',
    summary: [],
    to: '2026-10-16',
    trips: list,
  },
  status: ok('ONE-DA-200', 'Request completed successfully'),
});
