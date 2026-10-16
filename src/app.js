// -----------------------------------------------------------------------------
// The integration: the MyToyota account (e-mail, password, brand), the list of
// its vehicles (read once a day), their readings on the integration's own
// clock (15 minutes by default), the Gladys devices and states, the
// "trip ended" scene event, the transport badges, the "Test the connection"
// button and the "Read the vehicles now" scene action. index.js only wires the
// SDK handlers to it.
//
// Rate limits: requests are sent one at a time (src/client.js), a vehicle
// reads only the endpoints its capabilities list, the warning lights every 6
// hours, the last trip when the odometer moved (or every 6 hours), the
// vehicle list once a day. Nothing ever wakes the car (no
// POST /v1/remote/status): the API answers from Toyota's cache, which the car
// fills on its own (engine stop, locking…), so the 12 V battery is spared.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { ToyotaClient } from './client.js';
import { normalizeConfig } from './config.js';
import { LIMITS, SCENE_TRIGGERS, TIMINGS } from './constants.js';
import {
  buildDevices,
  parseExternalId,
  rolesOf,
  valuesOf,
  vehicleIds,
  vehicleName,
  vehicleStates,
  vinTail,
} from './devices.js';
import { KIND_NAMES, T, age, word } from './i18n.js';
import { StatePublisher } from './publisher.js';
import { fileStore, normalizeMemory } from './store.js';
import { errorReason } from './toyota.js';
import {
  readElectric,
  readHealth,
  readLastTrip,
  readLocation,
  readStatus,
  readTelemetry,
  readVehicles,
} from './vehicles.js';

const cut = (text, max = LIMITS.eventText) => (text.length > max ? text.slice(0, max) : text);

/** Errors after which only a change of the configuration (or the test button) helps. */
const REFUSED = new Set(['refused', 'no_credentials']);
/** Errors that stop the whole round: the account, the network or the rate limit. */
const FATAL = new Set([
  'refused',
  'no_credentials',
  'login_failed',
  'refresh_refused',
  'unauthorized',
  'rate_limited',
  'network',
  'timeout',
]);
/** An endpoint a vehicle refuses (403, 404, 4xx): not asked again for a day. */
const UNSUPPORTED = new Set(['forbidden', 'not_found', 'rejected']);
/** Errors meaning the cloud did not answer usefully: the vehicles are unreachable. */
const OFFLINE = new Set(['network', 'timeout', 'unavailable', 'bad_response', 'size']);

/** The readings, by endpoint: the client method and the reader of its answer. */
const ENDPOINTS = {
  telemetry: { call: 'telemetry', read: readTelemetry },
  electric: { call: 'electric', read: readElectric },
  status: { call: 'status', read: readStatus },
  location: { call: 'location', read: readLocation },
  health: { call: 'health', read: readHealth },
  trip: { call: 'lastTrip', read: readLastTrip },
};

/** The trip values recorded once per trip, at its end (publishStates with created_at). */
const TRIP_ROLES = ['last-trip-distance', 'last-trip-fuel'];

/** An error shown as such in the ack of an action or a scene action. */
const userError = (texts, language) => new Error(word(texts, language));

const round = (value, digits) =>
  value === undefined ? null : Math.round(value * 10 ** digits) / 10 ** digits;

export class ToyotaApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'toyota' }),
    transport,
    now = Date.now,
    timers = globalThis,
    sleep,
    requestGap,
    store = fileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.store = store;
    this.client = new ToyotaClient({
      transport,
      now,
      sleep,
      requestGap,
      onSession: (session) => this.saveSession(session),
    });
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.config = normalizeConfig();
    this.memory = normalizeMemory(null);
    /** The vehicles of the account (readVehicles), undefined before the first read. */
    this.vehicles = undefined;
    this.vehiclesAt = undefined;
    /** vin -> { telemetry, electric, status, location, health, trip } (the last good ones) */
    this.reads = new Map();
    /** `${vin}:${endpoint}` -> when it was last read */
    this.readAt = new Map();
    /** `${vin}:${endpoint}` -> until when it is not asked (refused by Toyota) */
    this.unsupported = new Map();
    /** vin -> the odometer when the last trip was read */
    this.tripOdometer = new Map();
    /** featureId -> the trip id whose value was sent */
    this.tripSent = new Map();
    this.published = undefined;
    /** deviceId -> badge last published (JSON) */
    this.transports = new Map();
    this.timer = undefined;
    this.running = undefined;
    this.generation = 0;
    this.refused = false;
    this.offline = false;
    this.connectedOnce = false;
    this.failures = 0;
    this.pausedUntil = 0;
    this.lastReadAt = -Infinity;
    this.lastScanAt = -Infinity;
    this.started = false;
    this.lastStatus = undefined;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    await this.running;
    this.config = normalizeConfig(raw);
    this.reset();
    this.memory = normalizeMemory(await this.store.load().catch(() => null));
    const { email, password, brand, account } = this.config;
    const session = this.memory.session?.account === account ? this.memory.session : null;
    this.client.configure({ email, password, brand, session });
    this.publisher.start();
    if (!this.client.hasCredentials) {
      await this.setStatus(false, T.noCredentials);
      return;
    }
    await this.setStatus(false, T.connecting);
    this.schedule();
    await this.tick();
  }

  stop() {
    this.generation += 1;
    if (this.timer) {
      this.timers.clearInterval(this.timer);
      this.timer = undefined;
    }
    this.publisher.stop();
  }

  /** Forgets the account and the failures: a new account, or a restart. */
  reset() {
    this.vehicles = undefined;
    this.vehiclesAt = undefined;
    this.reads.clear();
    this.readAt.clear();
    this.unsupported.clear();
    this.tripOdometer.clear();
    this.tripSent.clear();
    this.published = undefined;
    this.transports.clear();
    this.refused = false;
    this.offline = false;
    this.connectedOnce = false;
    this.failures = 0;
    this.pausedUntil = 0;
    this.lastReadAt = -Infinity;
  }

  schedule() {
    if (this.timer) {
      this.timers.clearInterval(this.timer);
    }
    this.timer = this.timers.setInterval(() => {
      this.tick().catch((err) => this.logger.error(`Toyota refresh failed: ${err.message}`));
    }, this.config.pollInterval * 1000);
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection (Gladys
   * restarted), resend what Gladys keeps in memory only (Discovery list,
   * status, badges) without reading the cloud again.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    await this.configUpdated(raw);
    this.published = undefined;
    this.transports.clear();
    const status = this.lastStatus;
    this.lastStatus = undefined;
    if (status) {
      const [connected, message] = JSON.parse(status);
      await this.setStatus(connected, message ?? undefined);
    }
    await this.publishDevices();
    await this.publishAllTransports();
  }

  /**
   * A new account restarts; a new interval reschedules; the position turned on
   * or off, or a new language, changes the devices.
   */
  async configUpdated(raw = {}) {
    const next = normalizeConfig(raw);
    const previous = this.config;
    if (
      next.email !== previous.email ||
      next.password !== previous.password ||
      next.brand !== previous.brand
    ) {
      return this.start(raw);
    }
    this.config = next;
    if (next.pollInterval !== previous.pollInterval && this.timer) {
      this.schedule();
    }
    if (next.gps !== previous.gps) {
      if (!next.gps) {
        // Turned off: the position is forgotten, not only hidden.
        for (const reads of this.reads.values()) {
          delete reads.location;
        }
      }
      await this.publishDevices();
      if (next.gps) {
        await this.tick({ only: 'location' });
      }
    } else if (next.language !== previous.language) {
      await this.publishDevices();
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  async saveSession(session) {
    this.memory.session = session ? { account: this.config.account, ...session } : null;
    await this.store
      .save(this.memory)
      .catch((err) => this.logger.warn(`Saving the session to /data failed: ${err.message}`));
  }

  // --- Polling ---------------------------------------------------------------

  /** One run at a time: a tick during a run joins it. */
  tick(options) {
    if (!this.running) {
      this.running = this.run(options).finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  /**
   * One round: the vehicle list when it is old (or `vehicles`), then the
   * readings of every vehicle (or of `vin`), `force` adding the warning lights
   * and the last trip, `only` limiting it to one endpoint.
   */
  async run({ vehicles = false, vin, force = false, only } = {}) {
    const generation = this.generation;
    if (!this.client.hasCredentials || this.refused || this.now() < this.pausedUntil) {
      return;
    }
    try {
      const stale =
        this.vehiclesAt === undefined || this.now() - this.vehiclesAt >= TIMINGS.vehiclesMaxAge;
      if (vehicles || stale) {
        await this.readVehicles(generation);
      }
      if (generation !== this.generation) {
        return;
      }
      await this.readAll(generation, { vin, force, only });
      if (generation !== this.generation) {
        return;
      }
      this.failures = 0;
      this.offline = false;
      this.connectedOnce = true;
      this.lastReadAt = this.now();
      await this.setStatus(true, this.statusMessage());
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      await this.failed(err);
    }
    await this.publishAllTransports();
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  async readVehicles(generation) {
    const vehicles = readVehicles(await this.client.vehicles());
    if (generation !== this.generation) {
      return;
    }
    this.vehicles = vehicles;
    this.vehiclesAt = this.now();
    for (const vin of [...this.reads.keys()]) {
      if (!vehicles.some((v) => v.vin === vin)) {
        this.reads.delete(vin);
      }
    }
    this.logger.info(
      `MyToyota: ${vehicles.length} vehicle(s): ${vehicles.map((v) => `${v.kind} ${vinTail(v.vin)}`).join(', ')}`,
    );
    await this.publishDevices();
  }

  /** The endpoints to read for a vehicle this round, before the last trip. */
  plan(vehicle, { force, only }) {
    const can = vehicle.capabilities;
    const list = [];
    if (can.telemetry) {
      list.push('telemetry');
    }
    if (can.electric) {
      list.push('electric');
    }
    if (can.status) {
      list.push('status');
    }
    if (this.config.gps && can.location) {
      list.push('location');
    }
    if (force || this.due(vehicle.vin, 'health', TIMINGS.healthMaxAge)) {
      list.push('health');
    }
    return list.filter(
      (endpoint) => (!only || endpoint === only) && this.supported(vehicle.vin, endpoint),
    );
  }

  due(vin, endpoint, maxAge) {
    const at = this.readAt.get(`${vin}:${endpoint}`);
    return at === undefined || this.now() - at >= maxAge;
  }

  supported(vin, endpoint) {
    const until = this.unsupported.get(`${vin}:${endpoint}`);
    return until === undefined || this.now() >= until;
  }

  /** The last trip: on the first round, when the odometer moved, every 6 hours, or forced. */
  tripDue(vehicle, force) {
    if (!this.supported(vehicle.vin, 'trip')) {
      return false;
    }
    const odometer = this.reads.get(vehicle.vin)?.telemetry?.odometer;
    const moved = odometer !== undefined && odometer !== this.tripOdometer.get(vehicle.vin);
    return force || moved || this.due(vehicle.vin, 'trip', TIMINGS.tripsMaxAge);
  }

  /**
   * The readings of every vehicle, one request at a time. A refused endpoint
   * is left aside for a day, a 5xx for this round; the account, the network
   * or a 429 stop the round. Nothing read at all fails the round.
   */
  async readAll(generation, { vin, force = false, only } = {}) {
    let read = 0;
    let firstError;
    const vehicles = (this.vehicles ?? []).filter((v) => !vin || v.vin === vin);
    for (const vehicle of vehicles) {
      const endpoints = this.plan(vehicle, { force, only });
      let tripChecked = Boolean(only);
      for (let i = 0; i <= endpoints.length; i += 1) {
        let endpoint = endpoints[i];
        if (endpoint === undefined) {
          if (tripChecked || !this.tripDue(vehicle, force)) {
            break;
          }
          tripChecked = true;
          endpoint = 'trip';
        }
        try {
          await this.readEndpoint(vehicle, endpoint);
          if (generation !== this.generation) {
            return;
          }
          read += 1;
        } catch (err) {
          if (generation !== this.generation) {
            return;
          }
          if (FATAL.has(err.kind) || err.kind === undefined) {
            throw err;
          }
          if (UNSUPPORTED.has(err.kind)) {
            this.unsupported.set(
              `${vehicle.vin}:${endpoint}`,
              this.now() + TIMINGS.unsupportedPause,
            );
          }
          this.logger.warn(
            `${vinTail(vehicle.vin)} ${endpoint}: ${errorReason(err)}${
              UNSUPPORTED.has(err.kind) ? ', not asked again for a day' : ''
            }`,
          );
          firstError ??= err;
        }
      }
      this.queueStates(vehicle);
    }
    if (read === 0 && firstError) {
      throw firstError;
    }
  }

  async readEndpoint(vehicle, endpoint) {
    const { call, read } = ENDPOINTS[endpoint];
    const value = read(await this.client[call](vehicle.vin));
    this.readAt.set(`${vehicle.vin}:${endpoint}`, this.now());
    const reads = this.reads.get(vehicle.vin) ?? {};
    this.reads.set(vehicle.vin, reads);
    if (endpoint === 'trip') {
      this.tripOdometer.set(vehicle.vin, reads.telemetry?.odometer);
      if (value !== undefined) {
        this.tripRead(vehicle, reads.trip, value);
        reads.trip = value;
      }
    } else if (value !== undefined) {
      reads[endpoint] = value;
    }
  }

  /** A new last trip (not the first one read): the `trip_ended` scene event. */
  tripRead(vehicle, previous, trip) {
    if (previous === undefined || !trip || trip.id === previous?.id) {
      return;
    }
    if (
      previous &&
      trip.endAt !== undefined &&
      previous.endAt !== undefined &&
      trip.endAt < previous.endAt
    ) {
      return;
    }
    const ids = vehicleIds(this.gladys, vehicle.vin);
    const name = vehicleName(vehicle);
    this.logger.info(`${vinTail(vehicle.vin)}: trip ended, ${round(trip.distance, 1)} km`);
    this.publisher.pushSceneEvent(SCENE_TRIGGERS.TRIP_ENDED, {
      vehicle: ids.device,
      vehicle_name: cut(name),
      distance_km: round(trip.distance, 1),
      duration_min: trip.minutes === undefined ? null : Math.round(trip.minutes),
      fuel_l: round(trip.fuel, 2),
      consumption_l_100km: round(trip.consumption, 1),
      ev_percent: trip.evPercent === undefined ? null : Math.round(trip.evPercent),
      score: trip.score === undefined ? null : Math.round(trip.score),
      ended_at: trip.endAt === undefined ? null : new Date(trip.endAt).toISOString(),
    });
  }

  statusMessage() {
    return T.connected((this.vehicles ?? []).map((v) => vehicleName(v)));
  }

  async failed(err) {
    const reason = errorReason(err);
    if (REFUSED.has(err.kind)) {
      // Never signed in again by itself: Toyota locks accounts that insist.
      this.refused = true;
      this.offline = true;
      this.logger.warn(`MyToyota refused the sign-in: ${reason}`);
      await this.setStatus(false, this.connectedOnce ? T.expired : T.refused);
      return;
    }
    let wait;
    if (err.kind === 'rate_limited') {
      wait = Math.max(err.retryAfter ?? TIMINGS.rateLimitPause, TIMINGS.backoff[0]);
      if (err.login) {
        this.offline = true;
        await this.setStatus(false, T.loginLimited(age(wait)));
      } else {
        await this.setStatus(this.connectedOnce, T.rateLimited(age(wait)));
      }
    } else if (err.kind === 'login_failed') {
      wait = TIMINGS.loginFailurePause;
      this.offline = true;
      await this.setStatus(false, T.loginFailed(age(wait)));
    } else {
      wait = TIMINGS.backoff[Math.min(this.failures, TIMINGS.backoff.length - 1)];
      this.offline = OFFLINE.has(err.kind) || this.offline;
      await this.setStatus(false, T.unreachable(reason, age(wait)));
    }
    this.failures += 1;
    this.pausedUntil = this.now() + wait;
    this.logger.warn(`MyToyota: ${reason}; next try in ${Math.round(wait / 1000)} s`);
  }

  // --- Gladys ----------------------------------------------------------------

  options() {
    return { gps: this.config.gps, language: this.config.language };
  }

  async publishDevices() {
    if (!this.vehicles) {
      return;
    }
    const devices = buildDevices(this.gladys, this.vehicles, this.options());
    const json = JSON.stringify(devices);
    if (json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  createdFeatures() {
    return new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  /**
   * The states of a vehicle's created features (publishChangedStates drops
   * the unchanged ones). The trip values go once per trip, dated at its end.
   */
  queueStates(vehicle, created = this.createdFeatures()) {
    const reads = this.reads.get(vehicle.vin);
    if (!reads) {
      return;
    }
    const ids = vehicleIds(this.gladys, vehicle.vin);
    const tripRoles = new Set(TRIP_ROLES.map((role) => ids.feature(role)));
    for (const { device_feature_external_id: id, ...value } of vehicleStates(
      this.gladys,
      vehicle,
      reads,
      this.options(),
    )) {
      if (!created.has(id)) {
        continue;
      }
      if (!tripRoles.has(id)) {
        this.publisher.push(id, value);
      } else if (reads.trip && this.tripSent.get(id) !== reads.trip.id) {
        this.tripSent.set(id, reads.trip.id);
        const at = reads.trip.endAt;
        this.publisher.pushEvent(
          id,
          at === undefined ? value : { ...value, created_at: new Date(at).toISOString() },
        );
      }
    }
  }

  badge(vehicle) {
    if (this.refused || this.offline || !this.reads.has(vehicle.vin)) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    return { transport: DEVICE_TRANSPORTS.CLOUD };
  }

  async publishAllTransports() {
    if (!this.vehicles) {
      return;
    }
    const created = new Set((this.gladys.devices ?? []).map((d) => d.external_id));
    const list = [];
    for (const vehicle of this.vehicles) {
      const externalId = vehicleIds(this.gladys, vehicle.vin).device;
      if (!created.has(externalId)) {
        continue;
      }
      const badge = { external_id: externalId, ...this.badge(vehicle) };
      const json = JSON.stringify(badge);
      if (this.transports.get(externalId) !== json) {
        this.transports.set(externalId, json);
        list.push(badge);
      }
    }
    if (list.length > 0) {
      await this.gladys
        .publishTransports(list)
        .catch((err) => this.logger.warn(`Transport badges failed: ${err.message}`));
    }
  }

  /** A device was created (or updated): send its last values at once. */
  async deviceCreated(device) {
    this.transports.delete(device?.external_id);
    const created = this.createdFeatures();
    for (const f of device?.features ?? []) {
      created.add(f.external_id);
      this.tripSent.delete(f.external_id);
    }
    for (const vehicle of this.vehicles ?? []) {
      this.queueStates(vehicle, created);
    }
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
    await this.publishAllTransports();
  }

  async deviceDeleted(device) {
    this.transports.delete(device?.external_id);
    if (device?.external_id) {
      this.publisher.forget(device.external_id);
      for (const f of device.features ?? []) {
        this.tripSent.delete(f.external_id);
      }
    }
  }

  /** The Discovery tab asks for a scan: the vehicle list again, if not read just now. */
  async scan() {
    if (
      this.client.hasCredentials &&
      !this.refused &&
      this.now() - this.lastScanAt >= TIMINGS.scanCooldown
    ) {
      this.lastScanAt = this.now();
      await this.tick({ vehicles: true });
      return;
    }
    await this.publishDevices();
  }

  // --- Scene action -----------------------------------------------------------

  /**
   * "Read the vehicles now" (or one vehicle): every reading, the warning
   * lights and the last trip included, unless read less than two minutes ago.
   */
  async sceneRefresh(fields = {}) {
    const language = this.config.language;
    if (this.refused) {
      throw userError(T.refused, language);
    }
    if (!this.vehicles) {
      throw userError(T.notReady, language);
    }
    let vin;
    if (fields.vehicle) {
      vin = parseExternalId(fields.vehicle)?.vin;
      if (!vin || !this.vehicles.some((v) => v.vin === vin)) {
        throw userError(T.unknownVehicle, language);
      }
    }
    if (this.now() - this.lastReadAt >= TIMINGS.testCooldown) {
      await this.running;
      await this.tick({ vin, force: true });
    }
    return {
      read_at: this.lastReadAt === -Infinity ? '' : new Date(this.lastReadAt).toISOString(),
    };
  }

  // --- "Test the connection" button -----------------------------------------

  async testConnection() {
    if (!this.client.hasCredentials) {
      return T.noCredentials;
    }
    if (this.vehicles && this.now() - this.lastReadAt < TIMINGS.testCooldown) {
      const summary = this.summary();
      return {
        en: `${T.test.cooldown.en} ${summary.en}`,
        fr: `${T.test.cooldown.fr} ${summary.fr}`,
      };
    }
    // One sign-in per click: the button is how a refused account is retried.
    this.refused = false;
    this.pausedUntil = 0;
    await this.running;
    await this.tick({ vehicles: true });
    const [connected, message] = JSON.parse(this.lastStatus ?? '[false,null]');
    if (!connected || !this.vehicles) {
      return message ?? T.noCredentials;
    }
    return this.summary();
  }

  /** The vehicles (name, kind, VIN end, what is read) and the interval. */
  summary() {
    const describe = (vehicle, lang) => {
      const values = valuesOf(vehicle, this.reads.get(vehicle.vin), { language: lang });
      const roles = rolesOf(vehicle, { gps: this.config.gps }).filter(
        (role) => values[role] !== undefined,
      );
      const read = lang === 'fr' ? `${roles.length} valeurs lues` : `${roles.length} values read`;
      return `${vehicleName(vehicle)} (${word(KIND_NAMES[vehicle.kind], lang)}, ${vinTail(vehicle.vin)}, ${read})`;
    };
    const list = (this.vehicles ?? []).map((v) => ({
      en: describe(v, 'en'),
      fr: describe(v, 'fr'),
    }));
    const head = T.test.vehicles(list);
    const interval = T.test.interval(age(this.config.pollInterval * 1000));
    return { en: `${head.en} ${interval.en}`, fr: `${head.fr} ${interval.fr}` };
  }
}
