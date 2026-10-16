// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { BRANDS, POLL_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  brand: 'toyota',
  poll_interval: POLL_INTERVAL.default,
  gps: false,
  language: 'fr',
};

export const LANGUAGES = ['fr', 'en'];

/** The account a session belongs to (e-mail and brand), without keeping the e-mail itself. */
export const accountKey = (email, brand) =>
  createHash('sha256').update(`${brand}:${email.trim().toLowerCase()}`).digest('hex').slice(0, 16);

const bounded = (raw, { min, max, default: fallback }) => {
  const value = Number(raw);
  if (raw === '' || raw === null || raw === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.round(Math.max(min, Math.min(max, value)));
};

/** A boolean field: true, "true", 1 or "1". */
const flag = (raw, fallback) => {
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }
  return raw === true || raw === 1 || raw === 'true' || raw === '1';
};

export function normalizeConfig(raw = {}) {
  const email = String(raw?.email ?? '').trim();
  const password = String(raw?.password ?? '');
  const language = String(raw?.language ?? DEFAULTS.language)
    .trim()
    .toLowerCase();
  const brand = String(raw?.brand ?? DEFAULTS.brand)
    .trim()
    .toLowerCase();
  const brandKey = brand in BRANDS ? brand : DEFAULTS.brand;
  return {
    email,
    password,
    brand: BRANDS[brandKey],
    account: email === '' ? '' : accountKey(email, BRANDS[brandKey]),
    pollInterval: bounded(raw?.poll_interval, POLL_INTERVAL),
    gps: flag(raw?.gps, DEFAULTS.gps),
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
  };
}
