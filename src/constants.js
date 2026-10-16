// -----------------------------------------------------------------------------
// Manifest keys, MyToyota (Toyota Connected Services Europe) constants, Gladys
// values, limits and timings.
// -----------------------------------------------------------------------------

/**
 * The sign-in of the MyToyota app (realm `tme`, shared by Toyota and Lexus)
 * and the API of Toyota Connected Services Europe: pytoyoda 6.0.0
 * `pytoyoda/const.py` and `pytoyoda/controller.py`, the same values as
 * node-red-contrib-toyota 0.3.4 `lib/core/protocol/toyota-eu-production.js`.
 * They are the public identifiers of the mobile app, not secrets.
 */
export const AUTH = {
  authenticateUrl:
    'https://b2c-login.toyota-europe.com/json/realms/root/realms/tme/authenticate?authIndexType=service&authIndexValue=oneapp',
  authorizeUrl:
    'https://b2c-login.toyota-europe.com/oauth2/realms/root/realms/tme/authorize?client_id=oneapp&scope=openid+profile+write&response_type=code&redirect_uri=com.toyota.oneapp:/oauth2Callback&code_challenge=plain&code_challenge_method=plain',
  tokenUrl: 'https://b2c-login.toyota-europe.com/oauth2/realms/root/realms/tme/access_token',
  clientId: 'oneapp',
  redirectUri: 'com.toyota.oneapp:/oauth2Callback',
  /** Basic oneapp:oneapp, lowercase "basic" as the app (pytoyoda TOYOTA_BASIC_AUTH). */
  basicAuth: 'basic b25lYXBwOm9uZWFwcA==',
  codeVerifier: 'plain',
  /** ForgeRock asks its questions in a few rounds; pytoyoda gives up after 10. */
  maxRounds: 10,
};

export const API = {
  host: 'https://ctpa-oneapi.tceu-ctp-prd.toyotaconnectedeurope.io',
  apiKey: 'tTZipv6liF74PwMfk9Ed68AQ0bISswwf3iHQdqcF',
  /** x-appversion, and the key of the x-client-ref HMAC. */
  clientVersion: '2.14.0',
  channel: 'ONEAPP',
  region: 'EU',
  userAgent: 'okhttp/4.10.0',
};

/** API paths (pytoyoda 6.0.0 const.py; the /v1/global/remote/* reads moved in 2026). */
export const PATHS = {
  vehicles: '/v2/vehicle/guid',
  telemetry: '/v3/telemetry',
  electric: '/v1/vehicle/electric/status',
  status: '/v1/vehicle/status',
  location: '/v1/location',
  health: '/v1/vehiclehealth/status',
  /** The newest trip first; `limit` 1 is the last trip. */
  trips: ({ from, to, limit = 1 }) =>
    `/v1/trips?from=${from}&to=${to}&summary=false&limit=${limit}&offset=0`,
};

/** The brand of the account: the x-brand header (Lexus adds x-appbrand and brand). */
export const BRANDS = { toyota: 'T', lexus: 'L' };

/**
 * Toyota fuel types (pytoyoda VehicleType.from_vehicle_info): B full hybrid,
 * E electric, I plug-in hybrid, anything else fuel only.
 */
export const FUEL_TYPES = { HYBRID: 'B', ELECTRIC: 'E', PLUG_IN: 'I' };

/** Raw charging statuses seen by pytoyoda / Home Assistant (lowercase). */
export const CHARGING = {
  CHARGING: 'charging',
  PLUGGED: 'plugged',
  COMPLETE: 'chargecomplete',
  NONE: 'none',
};

/**
 * Gladys values (server/utils/constants.js of the Gladys core, not exported by
 * the SDK).
 */
export const GLADYS = {
  /** CHARGING_STATION_CHARGING_STATE (the charging-state feature, 0 to 5). */
  CHARGING_STATE: { CHARGING: 0, EV_CONNECTED: 1, IDLE: 4, MAX: 5 },
  /** LOCK.STATE: lock/binary, 1 = locked. */
  LOCKED: 1,
  UNLOCKED: 0,
  /** electrical-vehicle-state door-opened / window-opened: 1 = open. */
  OPEN: 1,
  CLOSED: 0,
};

export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
};

export const SCENE_ACTIONS = {
  REFRESH: 'refresh',
};

export const SCENE_TRIGGERS = {
  TRIP_ENDED: 'trip_ended',
};

/** Seconds. Home Assistant polls every 6 minutes by default; we read less. */
export const POLL_INTERVAL = { min: 300, max: 86_400, default: 900 };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const LIMITS = {
  /** Gladys: 300 states per minute, 300 scene events per minute. */
  statesPerMinute: 300,
  sceneEventsPerMinute: 300,
  /** States per publishStates request. */
  statesPerRequest: 100,
  /** Largest answer read (the vehicle list of an account is ~15 KB per car). */
  responseBytes: 2 * 1024 * 1024,
  /** Scene event strings (Gladys accepts 1000 characters). */
  eventText: 200,
  /** Events kept while Gladys is unreachable. */
  queuedEvents: 500,
  /** remainingChargeTime above a day is a placeholder (65535) unless charging (pytoyoda). */
  chargeMinutes: 1440,
};

export const TIMINGS = {
  requestTimeout: 30_000,
  /**
   * Requests are sent one at a time with a pause in between: Toyota's gateway
   * answers 429 to bursts (pytoyoda reads its endpoints sequentially since
   * ha_toyota#282).
   */
  requestGap: 1_500,
  /** The publisher sends what is pending every second. */
  flushInterval: 1_000,
  /** An unchanged state is sent again every hour. */
  stateHeartbeat: HOUR,
  /** Renew the access token (about 1 hour) this long before it expires. */
  tokenMargin: 2 * MINUTE,
  /**
   * A 403 within this time of a call the same token passed is the endpoint's
   * refusal, not the token's (Toyota answers a bad token with 403 too).
   */
  tokenProof: 5 * MINUTE,
  /** Pauses after a failed read: 5, 10, 15, 30 then 60 minutes. */
  backoff: [5 * MINUTE, 10 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR],
  /** After a 429 without Retry-After. */
  rateLimitPause: 30 * MINUTE,
  /** After a sign-in that failed for another reason than the password (protocol change?). */
  loginFailurePause: 6 * HOUR,
  /** The vehicle list (and their capabilities) is read again at most this often. */
  vehiclesMaxAge: 24 * HOUR,
  /** The warning lights are read this often. */
  healthMaxAge: 6 * HOUR,
  /** The last trip is read when the odometer moved, and at least this often. */
  tripsMaxAge: 6 * HOUR,
  /** An endpoint a vehicle refused (403, 404…) is tried again after this. */
  unsupportedPause: 24 * HOUR,
  /** Trips older than this are not looked for (pytoyoda reads the last 90 days). */
  tripsWindowDays: 90,
  /** A Scan from the Discovery tab reads the vehicle list again at most this often. */
  scanCooldown: 10 * MINUTE,
  /** The "Test the connection" button and the refresh scene action read at most this often. */
  testCooldown: 2 * MINUTE,
};
