// -----------------------------------------------------------------------------
// The only network access: HTTPS requests to the MyToyota sign-in
// (b2c-login.toyota-europe.com) and to the Toyota Connected Services Europe
// API, and the errors they end with.
//
// The API is undocumented. What is used here was read from pytoyoda (MIT, the
// library of the Home Assistant integration ha_toyota) and
// node-red-contrib-toyota (MIT), as protocol documentation.
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';
import { LIMITS, TIMINGS } from './constants.js';

/**
 * A failed MyToyota call. `kind`:
 * - `no_credentials`: no e-mail or password in the configuration (never sent);
 * - `refused`: the sign-in was refused (wrong password, unknown e-mail);
 * - `login_failed`: the sign-in answered something unexpected (protocol change?);
 * - `refresh_refused`: the refresh token was refused (expired or revoked);
 * - `unauthorized`: the API refused the access token (401);
 * - `forbidden`: the API refused the request (403: a bad token, or this vehicle
 *   or account may not use it);
 * - `not_found`: unknown vehicle or endpoint (404);
 * - `rejected`: any other 4xx;
 * - `rate_limited`: too many requests (429), `retryAfter` in ms when given;
 * - `unavailable`: the cloud is down (5xx);
 * - `network`, `timeout`: no answer;
 * - `bad_response`, `size`: an answer that is not the expected JSON.
 */
export class ToyotaError extends Error {
  constructor(kind, message, { status, retryAfter, code, detail } = {}) {
    super(message);
    this.name = 'ToyotaError';
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
    /** The response code of the answer (`APIGW-403`, `ONE-GLOBAL-RS-40000`…), when any. */
    this.code = code;
    /** Toyota's explanation (`invalid guid and vin mapping`…), when any. */
    this.detail = detail;
  }
}

const NETWORK_REASONS = {
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset',
  EHOSTUNREACH: 'host unreachable',
  ENETUNREACH: 'network unreachable',
  ENOTFOUND: 'unknown host name',
  EAI_AGAIN: 'host name not resolved',
  ETIMEDOUT: 'connection timed out',
  EPIPE: 'connection closed',
};

/** A socket error -> ToyotaError (never the request: the sign-in carries the password). */
export function networkError(err) {
  if (err instanceof ToyotaError) {
    return err;
  }
  const reason = NETWORK_REASONS[err?.code] ?? err?.code ?? 'network error';
  return new ToyotaError('network', reason);
}

/** A short, secret-free reason for a log or a status message. */
export function errorReason(err) {
  if (err instanceof ToyotaError) {
    const code = err.code ? `, ${err.code}` : '';
    const detail = err.detail ? `: ${err.detail}` : '';
    return err.status ? `${err.message} (HTTP ${err.status}${code}${detail})` : err.message;
  }
  return String(err?.message ?? err);
}

/**
 * One request; resolves `{ status, headers, body }` whatever the status (a
 * redirect is returned, never followed). The promise settles once: a request
 * destroyed for its size or its timeout may still end or fail after that.
 * @param {string} url
 * @param {{ method?: string, headers?: object, body?: string, timeout?: number, maxBytes?: number }} options
 */
export function httpRequest(
  url,
  {
    method = 'GET',
    headers = {},
    body,
    timeout = TIMINGS.requestTimeout,
    maxBytes = LIMITS.responseBytes,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === 'https:' ? https : http;
    let timer;
    let settled = false;
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(value);
      }
    };
    const req = lib.request(target, { method, headers }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          settle(reject, new ToyotaError('size', 'answer too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () =>
        settle(resolve, {
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
      res.on('error', (err) => settle(reject, networkError(err)));
    });
    timer = setTimeout(() => {
      settle(
        reject,
        new ToyotaError('timeout', `no answer within ${Math.round(timeout / 1000)} s`),
      );
      req.destroy();
    }, timeout);
    req.on('error', (err) => settle(reject, networkError(err)));
    req.end(body);
  });
}

/** Retry-After (seconds or an HTTP date) -> milliseconds, undefined when absent. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** A JSON body, undefined when it is not JSON. */
export function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/**
 * The response code of an API answer: `{ status: { messages: [{ responseCode }] } }`
 * (pytoyoda StatusModel).
 */
export function responseCode(json) {
  const messages = json?.status?.messages;
  if (Array.isArray(messages) && typeof messages[0]?.responseCode === 'string') {
    return messages[0].responseCode;
  }
  return undefined;
}

/** The detailed description of an API answer, short (it goes into logs and statuses). */
export function responseDetail(json) {
  const detail = json?.status?.messages?.[0]?.detailedDescription;
  return typeof detail === 'string' && detail.trim() !== ''
    ? detail.trim().slice(0, 120)
    : undefined;
}

/** The error of a non-2xx API answer. */
export function apiError({ status, headers = {}, body }, { now } = {}) {
  const json = parseJson(body);
  const info = { status, code: responseCode(json), detail: responseDetail(json) };
  if (status === 429) {
    return new ToyotaError('rate_limited', 'too many requests', {
      ...info,
      retryAfter: parseRetryAfter(headers['retry-after'], now),
    });
  }
  if (status === 401) {
    return new ToyotaError('unauthorized', 'access refused', info);
  }
  if (status === 403) {
    return new ToyotaError('forbidden', 'request refused', info);
  }
  if (status === 404) {
    return new ToyotaError('not_found', 'unknown vehicle or service', info);
  }
  if (status >= 500) {
    return new ToyotaError('unavailable', 'Toyota is unavailable', info);
  }
  return new ToyotaError('rejected', 'request refused', info);
}

/** A JSON answer that must be an object. */
export function parseObject(body) {
  const json = parseJson(body);
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new ToyotaError('bad_response', 'Toyota sent an unexpected answer');
  }
  return json;
}
