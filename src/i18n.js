// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, button, feature names, last trip
// summary), in English and French, and the formatting of dates and numbers.
// -----------------------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The text of `texts` in `language`, English otherwise. */
export const word = (texts, language) => texts[language] ?? texts.en;

const LOCALES = { en: 'en-GB', fr: 'fr-FR' };

/** A date and time in the time zone of the container (TZ), "16/10/2026 14:05". */
export function formatDate(ms, language) {
  return new Intl.DateTimeFormat(LOCALES[language] ?? LOCALES.en, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(ms));
}

/** A number with at most `digits` decimals, in the language ("4,8" in French). */
export function formatNumber(value, language, digits = 1) {
  return new Intl.NumberFormat(LOCALES[language] ?? LOCALES.en, {
    maximumFractionDigits: digits,
  }).format(value);
}

export const BRAND_NAMES = { T: 'Toyota', L: 'Lexus' };

export const KIND_NAMES = {
  ev: { en: 'electric', fr: 'électrique' },
  phev: { en: 'plug-in hybrid', fr: 'hybride rechargeable' },
  hybrid: { en: 'hybrid', fr: 'hybride' },
  fuel: { en: 'combustion', fr: 'thermique' },
};

/** Feature names, in the language chosen in the configuration. */
export const FEATURE_NAMES = {
  'fuel-level': { en: 'Fuel level', fr: 'Niveau de carburant' },
  'battery-level': { en: 'Battery level', fr: 'Niveau de batterie' },
  'electric-range': { en: 'Electric range', fr: 'Autonomie électrique' },
  'fuel-range': { en: 'Fuel range', fr: 'Autonomie carburant' },
  'total-range': { en: 'Total range', fr: 'Autonomie totale' },
  odometer: { en: 'Odometer', fr: 'Kilométrage' },
  'charging-state': { en: 'Charging state', fr: 'État de la charge' },
  plugged: { en: 'Plugged in', fr: 'Branchée' },
  'charge-time-remaining': { en: 'Charge time remaining', fr: 'Temps de charge restant' },
  locked: { en: 'Locked', fr: 'Verrouillée' },
  'door-open': { en: 'Door open', fr: 'Porte ouverte' },
  'boot-open': { en: 'Boot open', fr: 'Coffre ouvert' },
  'bonnet-open': { en: 'Bonnet open', fr: 'Capot ouvert' },
  'window-open': { en: 'Window open', fr: 'Fenêtre ouverte' },
  position: { en: 'Parked position', fr: 'Position de stationnement' },
  'warning-lights': { en: 'Warning lights', fr: "Voyants d'alerte" },
  'last-trip': { en: 'Last trip', fr: 'Dernier trajet' },
  'last-trip-distance': { en: 'Last trip distance', fr: 'Distance du dernier trajet' },
  'last-trip-fuel': { en: 'Last trip fuel used', fr: 'Carburant du dernier trajet' },
  'last-update': { en: 'Last report from the car', fr: 'Dernière remontée de la voiture' },
};

/** "25 min" / "3 h", for the pauses. */
export function age(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 120) {
    return { en: `${minutes} min`, fr: `${minutes} min` };
  }
  const hours = Math.round(minutes / 60);
  return { en: `${hours} h`, fr: `${hours} h` };
}

/** What a text feature shows when there is nothing to show. */
export const NONE = '—';

/** "18/10/2026 14:05 · 15.2 km · 14 min · 1.5 L/100 km · 87 % electric · score 65". */
export function tripSummary(trip, language) {
  const n = (value, digits) => formatNumber(value, language, digits);
  const parts = [];
  if (trip.endAt !== undefined) {
    parts.push(formatDate(trip.endAt, language));
  }
  if (trip.distance !== undefined) {
    parts.push(`${n(trip.distance, 1)} km`);
  }
  if (trip.minutes !== undefined) {
    parts.push(`${Math.round(trip.minutes)} min`);
  }
  if (trip.consumption !== undefined && trip.fuel > 0) {
    parts.push(`${n(trip.consumption, 1)} L/100 km`);
  }
  if (trip.evPercent !== undefined) {
    parts.push(`${Math.round(trip.evPercent)} % ${word(KIND_NAMES.ev, language)}`);
  }
  if (trip.score !== undefined) {
    parts.push(`score ${Math.round(trip.score)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : NONE;
}

export const T = {
  noCredentials: {
    en: 'Enter the e-mail and password of your MyToyota (or Lexus Link) account.',
    fr: 'Saisissez l’e-mail et le mot de passe de votre compte MyToyota (ou Lexus Link).',
  },
  connecting: {
    en: 'Signing in to MyToyota…',
    fr: 'Connexion à MyToyota…',
  },
  connected: (names) =>
    names.length === 0
      ? {
          en: 'Connected to MyToyota, but the account has no connected vehicle.',
          fr: 'Connecté à MyToyota, mais le compte n’a aucun véhicule connecté.',
        }
      : {
          en: `Connected to MyToyota: ${plural(names.length, 'vehicle', 'vehicles')} (${names.join(', ')}). Open Discovery to add them.`,
          fr: `Connecté à MyToyota : ${plural(names.length, 'véhicule', 'véhicules')} (${names.join(', ')}). Ouvrez Découverte pour les ajouter.`,
        },
  refused: {
    en: 'MyToyota refused the e-mail or password. Check them and save: it is not retried on its own (Toyota may lock the account).',
    fr: 'MyToyota a refusé l’e-mail ou le mot de passe. Vérifiez-les et enregistrez : aucun nouvel essai automatique (Toyota peut bloquer le compte).',
  },
  expired: {
    en: 'MyToyota no longer accepts the password. Check it and save: it is not retried on its own.',
    fr: 'MyToyota n’accepte plus le mot de passe. Vérifiez-le et enregistrez : aucun nouvel essai automatique.',
  },
  loginFailed: (wait) => ({
    en: `The MyToyota sign-in answered unexpectedly (Toyota may have changed it). Next try in ${wait.en}.`,
    fr: `La connexion MyToyota a répondu de façon inattendue (Toyota l’a peut-être modifiée). Nouvel essai dans ${wait.fr}.`,
  }),
  loginLimited: (wait) => ({
    en: `Too many MyToyota sign-ins: next try in ${wait.en}.`,
    fr: `Trop de connexions à MyToyota : nouvel essai dans ${wait.fr}.`,
  }),
  rateLimited: (wait) => ({
    en: `Toyota asks to slow down (too many requests): next read in ${wait.en}.`,
    fr: `Toyota demande de ralentir (trop de requêtes) : prochaine lecture dans ${wait.fr}.`,
  }),
  unreachable: (reason, wait) => ({
    en: `MyToyota unreachable (${reason}). Next try in ${wait.en}.`,
    fr: `MyToyota injoignable (${reason}). Nouvel essai dans ${wait.fr}.`,
  }),
  notReady: {
    en: 'The vehicles have not been read yet: check the connection status of the integration.',
    fr: 'Les véhicules n’ont pas encore été lus : vérifiez l’état de connexion de l’intégration.',
  },
  unknownVehicle: {
    en: 'This vehicle is not in the MyToyota account (any more).',
    fr: 'Ce véhicule n’est pas (ou plus) dans le compte MyToyota.',
  },
  refreshed: {
    en: 'Read again.',
    fr: 'Relu.',
  },
  test: {
    cooldown: {
      en: 'Already read less than two minutes ago (Toyota limits requests).',
      fr: 'Déjà lu il y a moins de deux minutes (Toyota limite les requêtes).',
    },
    vehicles: (list) => ({
      en: `Signed in. ${list.length === 0 ? 'No connected vehicle.' : `${plural(list.length, 'vehicle', 'vehicles')}: ${list.map((v) => v.en).join('; ')}.`}`,
      fr: `Connecté. ${list.length === 0 ? 'Aucun véhicule connecté.' : `${plural(list.length, 'véhicule', 'véhicules')} : ${list.map((v) => v.fr).join(' ; ')}.`}`,
    }),
    interval: (wait) => ({
      en: `Read every ${wait.en}.`,
      fr: `Lecture toutes les ${wait.fr}.`,
    }),
  },
};
