// -----------------------------------------------------------------------------
// A fake MyToyota behind the transport the integration is given: the sign-in
// rounds (ForgeRock callbacks, cookies, 401 on a wrong password, "User Not
// Found"), the authorize redirect, the token endpoint (authorization code and
// refresh grants) and the API endpoints, checking the headers of the app.
// An endpoint without data answers 403 APIGW-403, as Toyota does for a
// vehicle that lacks it. Records every request. No network.
// -----------------------------------------------------------------------------

import { createHmac } from 'node:crypto';
import { API, AUTH } from '../../src/constants.js';
import { ToyotaError } from '../../src/toyota.js';
import {
  EMAIL,
  PASSWORD,
  UUID,
  VINS,
  apigw403,
  authorizeLocation,
  badToken,
  electric,
  health,
  location,
  missingToken,
  signInDone,
  signInRounds,
  telemetry,
  tokenAnswer,
  trips,
  userNotFound,
  vehicleStatus,
  vehicles,
  wrongPassword,
} from '../fixtures/toyota.js';

const answer = (status, body, headers = {}) => ({
  status,
  headers,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const ENDPOINTS = {
  '/v3/telemetry': 'telemetry',
  '/v1/vehicle/electric/status': 'electric',
  '/v1/vehicle/status': 'status',
  '/v1/location': 'location',
  '/v1/vehiclehealth/status': 'health',
  '/v1/trips': 'trips',
};

/** The data of a fresh account: the RAV4 PHEV and the Yaris hybrid, everything readable. */
export function defaultData() {
  return {
    vehicles: vehicles(),
    telemetry: {
      [VINS.RAV4]: telemetry({ odometer: 30420 }),
      [VINS.YARIS]: telemetry({ odometer: 12500, fuelLevel: 63, dte: 512 }),
    },
    electric: { [VINS.RAV4]: electric() },
    status: {
      [VINS.RAV4]: vehicleStatus({ vin: VINS.RAV4 }),
      [VINS.YARIS]: vehicleStatus({ vin: VINS.YARIS, locked: false }),
    },
    location: {
      [VINS.RAV4]: location({ vin: VINS.RAV4 }),
      [VINS.YARIS]: location({ vin: VINS.YARIS, latitude: 48.85837, longitude: 2.294481 }),
    },
    health: { [VINS.RAV4]: health(), [VINS.YARIS]: health({ vin: VINS.YARIS }) },
    trips: { [VINS.RAV4]: trips(), [VINS.YARIS]: trips([]) },
  };
}

export function fakeToyota({ data = defaultData() } = {}) {
  const server = {
    email: EMAIL,
    password: PASSWORD,
    data,
    /** { method, url, path, query, headers, json, form } */
    requests: [],
    accessTokens: new Set(),
    refreshTokens: new Set(),
    codes: new Set(),
    issued: 0,
    lifetime: 3599,
    /** No answer at all (DNS, connection refused). */
    down: false,
    /** One-shot answers: { match(request), status, body, headers } */
    queue: [],
    signIns() {
      return this.requests.filter(
        (r) => r.url === AUTH.authenticateUrl && r.json?.authId === undefined,
      );
    },
    grants(type) {
      return this.requests.filter((r) => r.url === AUTH.tokenUrl && r.form.grant_type === type);
    },
    apiCalls() {
      return this.requests.filter((r) => r.url.startsWith(API.host));
    },
    calls(endpoint, vin) {
      return this.apiCalls().filter(
        (r) => ENDPOINTS[r.path] === endpoint && (vin === undefined || r.headers.vin === vin),
      );
    },
    /** The next request matching `match` gets this answer instead. */
    once(match, status, body, headers) {
      this.queue.push({ match, status, body, headers });
    },
    revoke() {
      this.accessTokens.clear();
    },
    issue() {
      this.issued += 1;
      const access = `access-${this.issued}`;
      const refresh = `refresh-${this.issued}`;
      this.accessTokens.add(access);
      this.refreshTokens.add(refresh);
      return tokenAnswer({ access, refresh, lifetime: this.lifetime });
    },

    authenticate(request) {
      const callbacks = request.json?.callbacks;
      const rounds = signInRounds();
      const cookies = ['route=96df7747ca52; expires=Tue, 02-Jan-24 14:42:04 GMT; path=/'];
      cookies.push('amlbcookie=01; Path=/; Secure; HttpOnly; SameSite=none');
      if (!Array.isArray(callbacks)) {
        return answer(200, rounds[0], { 'set-cookie': cookies });
      }
      const prompts = callbacks.map((c) => c.output?.[0]?.value);
      if (prompts.includes('Market Locale')) {
        return answer(200, rounds[1], { 'set-cookie': cookies });
      }
      if (prompts.includes('User Name')) {
        const user = callbacks.find((c) => c.output?.[0]?.value === 'User Name').input[0].value;
        return answer(200, user === this.email ? rounds[2] : userNotFound(), {
          'set-cookie': cookies,
        });
      }
      const password = callbacks.find((c) => c.type === 'PasswordCallback')?.input[0].value;
      if (password !== undefined) {
        return password === this.password
          ? answer(200, signInDone())
          : answer(401, wrongPassword());
      }
      return answer(400, { code: 400, reason: 'Bad Request' });
    },

    authorize(request) {
      if (request.headers.Cookie !== `iPlanetDirectoryPro=${signInDone().tokenId}`) {
        return answer(401, { code: 401, reason: 'Unauthorized' });
      }
      const code = `code-${this.codes.size + 1}`;
      this.codes.add(code);
      return answer(302, '', { location: authorizeLocation(code) });
    },

    token(request) {
      const { form } = request;
      if (request.headers.Authorization !== AUTH.basicAuth || form.client_id !== AUTH.clientId) {
        return answer(401, { error: 'invalid_client' });
      }
      if (form.grant_type === 'authorization_code' && this.codes.delete(form.code)) {
        return answer(200, this.issue());
      }
      if (form.grant_type === 'refresh_token' && this.refreshTokens.has(form.refresh_token)) {
        this.refreshTokens.delete(form.refresh_token);
        return answer(200, this.issue());
      }
      return answer(400, { error: 'invalid_grant', error_description: 'grant is invalid' });
    },

    api(request) {
      const h = request.headers;
      if (!h.Authorization) {
        return answer(401, missingToken());
      }
      // A bad or expired token is a 403, as the real API answers.
      if (!this.accessTokens.has(String(h.Authorization).replace(/^Bearer /, ''))) {
        return answer(403, badToken());
      }
      const ref = createHmac('sha256', API.clientVersion).update(UUID).digest('hex');
      if (
        h['x-api-key'] !== API.apiKey ||
        h['x-guid'] !== UUID ||
        h['x-client-ref'] !== ref ||
        h['x-channel'] !== 'ONEAPP' ||
        h['x-region'] !== 'EU'
      ) {
        return answer(403, apigw403());
      }
      if (request.path === '/v2/vehicle/guid') {
        return answer(200, this.data.vehicles);
      }
      const endpoint = ENDPOINTS[request.path];
      const body = endpoint ? this.data[endpoint]?.[h.vin] : undefined;
      return body ? answer(200, body) : answer(403, apigw403());
    },

    async transport(url, { method = 'GET', headers = {}, body } = {}) {
      const target = new URL(url);
      const request = {
        method,
        url,
        path: target.pathname,
        query: Object.fromEntries(target.searchParams),
        headers,
        json: undefined,
        form: {},
      };
      if (url === AUTH.tokenUrl) {
        request.form = Object.fromEntries(new URLSearchParams(body ?? ''));
      } else if (body) {
        request.json = JSON.parse(body);
      }
      server.requests.push(request);
      if (server.down) {
        throw new ToyotaError('network', 'connection refused');
      }
      const index = server.queue.findIndex((q) => q.match(request));
      if (index >= 0) {
        const [q] = server.queue.splice(index, 1);
        return answer(q.status, q.body ?? '', q.headers);
      }
      if (url === AUTH.authenticateUrl) {
        return server.authenticate(request);
      }
      if (url === AUTH.authorizeUrl) {
        return server.authorize(request);
      }
      if (url === AUTH.tokenUrl) {
        return server.token(request);
      }
      if (url.startsWith(API.host)) {
        return server.api(request);
      }
      return answer(404, 'not found');
    },
  };
  server.transport = server.transport.bind(server);
  return server;
}

export function memoryStore(initial = null) {
  return {
    data: initial,
    saves: 0,
    async load() {
      return this.data === null ? null : structuredClone(this.data);
    },
    async save(data) {
      this.saves += 1;
      this.data = structuredClone(data);
    },
  };
}

/** Lets the pending promises settle (no timer involved). */
export const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
