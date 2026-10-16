// -----------------------------------------------------------------------------
// The MyToyota account: the sign-in of the app (ForgeRock callbacks, then an
// OAuth authorization code), the session (an access token of about an hour, a
// refresh token and the user uuid of the id token), renewed with the refresh
// token, and the read calls the integration needs. Every request goes
// through the transport of src/toyota.js.
//
// As pytoyoda does (controller.py): the access token is renewed just before
// it expires, a refused refresh token falls back once to the password, an API
// call refused with 401 gets one new token and one retry, and the API calls
// are sent one at a time (Toyota answers 429 to bursts).
// -----------------------------------------------------------------------------

import { createHmac, randomUUID } from 'node:crypto';
import { API, AUTH, BRANDS, PATHS, TIMINGS } from './constants.js';
import {
  ToyotaError,
  apiError,
  httpRequest,
  parseJson,
  parseObject,
  parseRetryAfter,
} from './toyota.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The `uuid` claim of an id token (a JWT read without checking its signature, as pytoyoda). */
export function tokenUuid(idToken) {
  if (typeof idToken !== 'string') {
    return undefined;
  }
  const part = idToken.split('.')[1];
  const claims = part ? parseJson(Buffer.from(part, 'base64url').toString('utf8')) : undefined;
  return typeof claims?.uuid === 'string' && claims.uuid !== '' ? claims.uuid : undefined;
}

/** `YYYY-MM-DD` of a time, in UTC. */
export const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** The cookies a sign-in answer sets (`name=value` only), added to `jar`. */
function keepCookies(jar, headers = {}) {
  const list = headers['set-cookie'];
  for (const line of Array.isArray(list) ? list : list ? [list] : []) {
    const pair = String(line).split(';')[0];
    const index = pair.indexOf('=');
    if (index > 0) {
      jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }
}

const cookieHeader = (jar) => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');

export class ToyotaClient {
  constructor({
    transport = httpRequest,
    now = Date.now,
    sleep = wait,
    requestGap = TIMINGS.requestGap,
    onSession,
  } = {}) {
    this.transport = transport;
    this.now = now;
    this.sleep = sleep;
    this.requestGap = requestGap;
    /** Called with the new session after each sign-in or renewal (never throws). */
    this.onSession = onSession;
    this.email = '';
    this.password = '';
    this.brand = BRANDS.toyota;
    /** { accessToken, expiresAt, refreshToken, uuid } | null */
    this.session = null;
    this.signingIn = undefined;
    /** The API calls, one after the other. */
    this.queue = Promise.resolve();
    this.lastRequestAt = -Infinity;
    /** The last access token an API call accepted, and when. */
    this.provenToken = null;
    this.provenAt = -Infinity;
  }

  configure({ email, password, brand = BRANDS.toyota, session = null }) {
    this.email = email;
    this.password = password;
    this.brand = brand;
    this.provenToken = null;
    this.session = session
      ? {
          accessToken: session.accessToken ?? null,
          expiresAt: session.expiresAt ?? 0,
          refreshToken: session.refreshToken ?? null,
          uuid: session.uuid ?? null,
        }
      : null;
  }

  get hasCredentials() {
    return this.email !== '' && this.password !== '';
  }

  async save() {
    try {
      await this.onSession?.(this.session);
    } catch {
      // Saving is best effort: the session still works in memory.
    }
  }

  // --- Sign-in ----------------------------------------------------------------

  /** Whether the access token can be used for one more request. */
  tokenValid() {
    const s = this.session;
    return Boolean(s?.accessToken && s.uuid) && this.now() < s.expiresAt - TIMINGS.tokenMargin;
  }

  /**
   * A new access token: from the refresh token when there is one (it falls
   * back to the password when Toyota refuses it), else from the password. One
   * at a time, the other requests wait for it.
   */
  authenticate() {
    if (!this.hasCredentials) {
      return Promise.reject(new ToyotaError('no_credentials', 'no e-mail or password'));
    }
    if (!this.signingIn) {
      const { email } = this;
      this.signingIn = this.renew()
        .then(async (tokens) => {
          // A sign-in started for another account never overwrites the new one.
          if (this.email === email) {
            this.session = tokens;
            await this.save();
          }
          return tokens;
        })
        .finally(() => {
          this.signingIn = undefined;
        });
    }
    return this.signingIn;
  }

  async renew() {
    // The credentials of this sign-in, even if the configuration changes meanwhile.
    const credentials = { email: this.email, password: this.password };
    const previous = this.session;
    if (previous?.refreshToken) {
      try {
        return await this.grant(
          {
            client_id: AUTH.clientId,
            redirect_uri: AUTH.redirectUri,
            grant_type: 'refresh_token',
            code_verifier: AUTH.codeVerifier,
            refresh_token: previous.refreshToken,
          },
          { previous },
        );
      } catch (err) {
        if (err.kind !== 'refresh_refused') {
          throw err;
        }
        if (this.session) {
          this.session.refreshToken = null;
        }
      }
    }
    return this.signIn(credentials);
  }

  /** The e-mail and password, through the rounds of questions of the sign-in page. */
  async signIn({ email, password }) {
    const jar = new Map();
    let data = {};
    let tokenId;
    for (let round = 0; round < AUTH.maxRounds && !tokenId; round += 1) {
      for (const callback of Array.isArray(data.callbacks) ? data.callbacks : []) {
        const prompt = callback?.output?.[0]?.value;
        const input = callback?.input?.[0];
        if (callback?.type === 'NameCallback' && prompt === 'User Name' && input) {
          input.value = email;
        } else if (callback?.type === 'PasswordCallback' && input) {
          input.value = password;
        }
      }
      const body = JSON.stringify(data);
      const answer = await this.transport(AUTH.authenticateUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': API.userAgent,
          ...(jar.size > 0 ? { Cookie: cookieHeader(jar) } : {}),
        },
        body,
      });
      keepCookies(jar, answer.headers);
      if (answer.status === 401) {
        // {"code":401,"reason":"Unauthorized","message":"Login failure"}: the password.
        throw new ToyotaError('refused', 'e-mail or password refused', { status: 401 });
      }
      if (answer.status !== 200) {
        throw this.signInError(answer);
      }
      data = parseObject(answer.body);
      if (typeof data.tokenId === 'string' && data.tokenId !== '') {
        tokenId = data.tokenId;
      } else if (!Array.isArray(data.callbacks)) {
        throw new ToyotaError('login_failed', 'the sign-in page asked something unexpected');
      } else if (
        data.callbacks.some(
          (c) => c?.type === 'TextOutputCallback' && c?.output?.[0]?.value === 'User Not Found',
        )
      ) {
        throw new ToyotaError('refused', 'unknown e-mail');
      }
    }
    if (!tokenId) {
      throw new ToyotaError('login_failed', 'the sign-in did not end');
    }
    const answer = await this.transport(AUTH.authorizeUrl, {
      method: 'GET',
      headers: { Cookie: `iPlanetDirectoryPro=${tokenId}`, 'User-Agent': API.userAgent },
    });
    if (answer.status !== 302) {
      throw this.signInError(answer);
    }
    let code;
    try {
      code = new URL(String(answer.headers?.location ?? '')).searchParams.get('code');
    } catch {
      code = null;
    }
    if (!code) {
      throw new ToyotaError('login_failed', 'no authorization code', { status: 302 });
    }
    return this.grant({
      client_id: AUTH.clientId,
      code,
      redirect_uri: AUTH.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: AUTH.codeVerifier,
    });
  }

  signInError({ status, headers = {} }) {
    if (status === 429) {
      const err = new ToyotaError('rate_limited', 'too many sign-ins', {
        status,
        retryAfter: parseRetryAfter(headers['retry-after'], this.now()),
      });
      err.login = true;
      return err;
    }
    if (status >= 500) {
      return new ToyotaError('unavailable', 'the Toyota sign-in is unavailable', { status });
    }
    return new ToyotaError('login_failed', 'the sign-in answered unexpectedly', { status });
  }

  /** The token endpoint: an authorization code, or a refresh token (`previous` session). */
  async grant(form, { previous } = {}) {
    const body = new URLSearchParams(form).toString();
    const answer = await this.transport(AUTH.tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: AUTH.basicAuth,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': API.userAgent,
      },
      body,
    });
    if (answer.status !== 200) {
      if (previous && (answer.status === 400 || answer.status === 401)) {
        throw new ToyotaError('refresh_refused', 'session refused', { status: answer.status });
      }
      throw this.signInError(answer);
    }
    const json = parseObject(answer.body);
    const lifetime = Number(json.expires_in);
    const uuid = tokenUuid(json.id_token) ?? previous?.uuid;
    if (typeof json.access_token !== 'string' || json.access_token === '' || !uuid) {
      throw new ToyotaError('login_failed', 'Toyota sent no usable token');
    }
    const refreshToken =
      typeof json.refresh_token === 'string' && json.refresh_token !== ''
        ? json.refresh_token
        : (previous?.refreshToken ?? null);
    return {
      accessToken: json.access_token,
      expiresAt: this.now() + (Number.isFinite(lifetime) && lifetime > 0 ? lifetime : 3600) * 1000,
      refreshToken,
      uuid,
    };
  }

  /** A usable session (the one just obtained, even if the account changed meanwhile). */
  async token() {
    if (!this.tokenValid()) {
      return this.authenticate();
    }
    return this.session;
  }

  // --- Requests ---------------------------------------------------------------

  /** The headers of the app (pytoyoda Controller._prepare_headers). */
  headers({ accessToken, uuid }, vin) {
    const headers = {
      Accept: 'application/json',
      'x-api-key': API.apiKey,
      API_KEY: API.apiKey,
      'x-guid': uuid,
      guid: uuid,
      'x-client-ref': createHmac('sha256', API.clientVersion).update(uuid).digest('hex'),
      'x-correlationid': randomUUID(),
      'x-appversion': API.clientVersion,
      'x-channel': API.channel,
      'x-brand': this.brand,
      'x-region': API.region,
      'x-user-region': API.region,
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': API.userAgent,
    };
    if (this.brand === BRANDS.lexus) {
      headers['x-appbrand'] = this.brand;
      headers.brand = this.brand;
    }
    if (vin !== undefined) {
      headers.vin = vin;
    }
    return headers;
  }

  /** Waits for the previous call, then for the gap since it. */
  paced(run) {
    const next = this.queue.then(async () => {
      const delay = this.lastRequestAt + this.requestGap - this.now();
      if (delay > 0) {
        await this.sleep(delay);
      }
      try {
        return await run();
      } finally {
        this.lastRequestAt = this.now();
      }
    });
    this.queue = next.catch(() => {});
    return next;
  }

  async send(path, session, vin) {
    const answer = await this.transport(`${API.host}${path}`, {
      method: 'GET',
      headers: this.headers(session, vin),
    });
    if (answer.status !== 200 && answer.status !== 202) {
      throw apiError(answer, { now: this.now() });
    }
    return answer.body;
  }

  /** The access token worked (or a fresh one was refused too): a 403 is the endpoint's. */
  prove(accessToken) {
    this.provenToken = accessToken;
    this.provenAt = this.now();
  }

  proven(accessToken) {
    return this.provenToken === accessToken && this.now() - this.provenAt < TIMINGS.tokenProof;
  }

  /**
   * One GET. Toyota answers a bad or expired token with 403 APIGW-403 (seen
   * 2026-10-16), the same as an endpoint a vehicle may not use: a 401, or a
   * 403 with a token that has not worked in the last minutes, gets one new
   * token (the refresh token is kept) and one retry.
   */
  get(path, vin) {
    return this.paced(async () => {
      let session = await this.token();
      let body;
      try {
        body = await this.send(path, session, vin);
      } catch (err) {
        const suspect =
          err.kind === 'unauthorized' ||
          (err.kind === 'forbidden' && !this.proven(session.accessToken));
        if (!suspect) {
          throw err;
        }
        if (this.session?.accessToken === session.accessToken) {
          this.session.accessToken = null;
        }
        session = await this.token();
        try {
          body = await this.send(path, session, vin);
        } catch (again) {
          if (again.kind === 'forbidden') {
            this.prove(session.accessToken);
          }
          throw again;
        }
      }
      this.prove(session.accessToken);
      return parseObject(body);
    });
  }

  /** The vehicles of the account (`payload`: VehicleGuidModel list). */
  vehicles() {
    return this.get(PATHS.vehicles);
  }

  telemetry(vin) {
    return this.get(PATHS.telemetry, vin);
  }

  electric(vin) {
    return this.get(PATHS.electric, vin);
  }

  status(vin) {
    return this.get(PATHS.status, vin);
  }

  location(vin) {
    return this.get(PATHS.location, vin);
  }

  health(vin) {
    return this.get(PATHS.health, vin);
  }

  /** The last trip of the last `days` days (newest first, one). */
  lastTrip(vin, days = TIMINGS.tripsWindowDays) {
    const to = this.now();
    const from = to - days * 24 * 60 * 60_000;
    return this.get(PATHS.trips({ from: isoDay(from), to: isoDay(to) }), vin);
  }
}
