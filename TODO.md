# TODO — Toyota / Lexus v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm run audit`, then update README, `docs/en.md`, `docs/fr.md`,
  `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).
- No forum topic of its own, ever, and no forum post from a module session:
  the claim is post #224 of /t/10385; the main session posts one recap there,
  with a link to each repo, once the batch is published.

## Status

- [x] **Milestone 1 — core, read only** (2026-10-16): MyToyota sign-in
      (ForgeRock callbacks with the load-balancer cookies, authorize redirect
      with `iPlanetDirectoryPro`, authorization code then refresh grants,
      `uuid` of the id token, tokens in `/data` with a hash of e-mail and
      brand, refused refresh -> one sign-in, 401 or 403 on an unproven token
      -> one new token and one retry, refused password never retried by
      itself, unexpected sign-in -> 6 h pause), brand Toyota or Lexus (`x-brand`, `x-appbrand`, `brand`);
      vehicle list (capabilities, kind from the fuel type) at start, daily and
      on Scan (10 min cooldown); per car and per round (900 s, 300–86400) the
      endpoints its capabilities allow, one request at a time 1.5 s apart,
      health every 6 h, last trip when the odometer moved (or 6 h); per
      endpoint errors (4xx -> a day aside, 5xx -> the round, 429 -> stop and
      Retry-After or 30 min, network -> 5/10/15/30/60 min); one device per car
      (`vehicle:<VIN>`, 20 roles, see CLAUDE.md), states through
      `publishChangedStates` (1 h heartbeat), trip distance and fuel once per
      trip dated at its end; scene trigger `trip_ended`, scene action
      `refresh` (vehicle optional, 2 min cooldown); optional parked position
      (off by default, forgotten when turned off); badges; "Test the
      connection"; en/fr names; docs en/fr. Tested against fixtures adapted
      from pytoyoda only.
- [ ] **Milestone 2 — real account**: run against a real MyToyota account
      (ideally a hybrid and a plug-in or electric car) and compare with the
      app (see "To check on a real account"); turn the answers (anonymized:
      VIN, uuid, position, tokens) into fixtures; fix what differs.
- [ ] **Milestone 3 — remote commands, opt-in**: only once checked on a
      real car (see Decisions): door lock/unlock (`POST
/v1/global/remote/command` `{command: "door-lock" | "door-unlock"}`,
      gated on `remoteDisplay` 7 and `doorLockUnlockCapable`, unlock behind a
      second option, the state held until the next status shows it), climate
      start/stop (`POST /v2/remote/climate-control`, one start = one unit of
      the per-ignition quota: a scene action with all settings at once, never
      a dashboard toggle per setting), charge now (`POST
/v1/global/remote/electric/command` `CHARGE_NOW`); a "wake the car" scene
      action (`POST /v1/remote/status`, drains the 12 V battery: limited to a
      few per day).
- [ ] **Milestone 4 — more**: a dashboard widget per car; the next service
      (not in the API today: only the service history,
      `/v1/servicehistory/vehicle/summary`); notifications as scene events
      (`/v2/notification/history`); daily/monthly trip summaries (`summary=
true`); distance from home with `location: true` and `getHouses()`;
      cabin temperature (`/v1/vehicle/climate-status`) when climate lands.
- [ ] **Milestone 5 — first release**: cover image, Docker image build check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic, GHCR package public (the main session does it).

## To check on a real account

- Sign-in: the rounds of callbacks today (market/locale questions first?),
  the cookies needed, the 401 of a wrong password, a locked account's answer,
  the `authorize` 302, the token answer (`expires_in` 3599?), the refresh
  grant (is the refresh token rotated? its lifetime?), whether `plain` PKCE
  and app version 2.14.0 still pass (iobroker.toyota 0.4.0 uses S256 and
  2.25.2: the fallback if Toyota tightens it).
- A Lexus account with brand L: same realm `tme`? Does a Lexus also appear
  with brand T?
- The request budget before a 429 (900 s and 4–6 requests per car per round
  are below Home Assistant's 6 minutes with ~10 endpoints) and whether a 429
  carries `Retry-After`.
- Capabilities: are `telemetryCapable`, `vehicleStatus`,
  `lastParkedCapable`/`features.lastParked`, `bonnetStatus` and
  `econnectVehicleStatusCapable` reliable for European cars (pytoyoda widens
  the electric gate for Suzuki-built BEVs and PHEVs)?
- `/v1/vehicle/status`: which doors and windows each model reports, the boot
  (`rearBack`) lock, the hood; how stale it gets without the wake-up.
- `/v1/vehicle/electric/status`: the charging statuses really seen (`none`,
  `charging`, `plugged`, `chargeComplete`, others?), the units of the ranges
  (the fixture gives the fuel range in miles), `remainingChargeTime`.
- Telemetry of a plug-in hybrid: `batteryLevel` and `distanceToEmpty` (fuel
  or total?).
- `/v1/vehiclehealth/status` `warning`: what an entry looks like (only the
  count is used).
- `/v1/trips`: `summary=false` accepted (pytoyoda formats `False`), how soon
  after a stop the trip shows, `fuelConsumption` of an electric car,
  `hdc.evDistance` of a full hybrid.
- Position: precision, how often `lastParked` updates.
- Two tools on one account (the app, Home Assistant, this integration): do
  sessions sign each other out?

## Decisions

- **Not a duplicate** (checked 2026-10-16):
  - Store index (`integration-store-storage.gladysassistant.com/index.json`,
    433 entries, generated 2026-10-16T11:15Z) and `rejected.json`: no
    Toyota, Lexus or MyToyota entry. Car integrations present: Renault,
    Stellantis, Tesla, Hyundai-Kia, MySkoda (guim31), FordPass (gboulvin),
    plus chargers. Will_71 claimed Mercedes, BMW and BYD in /t/10385 #187.
  - Gladys core master `0027571` (2026-10-16): `git grep -i -E
'toyota|lexus'` finds nothing in `server/` or `front/src`.
  - Forum search "toyota": only our claim (#224 of /t/10385).
  - GitHub search "gladys toyota": only this repository.
  - Toyota North America (another API, the Toyota app of North America)
    is out of scope.
- **Own client, pytoyoda as the protocol reference** (2026-10-16):
  - pytoyoda 6.0.0 (MIT, 2026-10-15, very active, the library of the Home
    Assistant integration ha_toyota) is Python: read as documentation, the
    fixtures adapted from its recorded answers.
  - node-red-contrib-toyota 0.3.4 (MIT, 2026-09-05) has a Node client in
    `lib/core`, but the package depends on `better-sqlite3` (a native module
    built or downloaded at install, for its trip storage) and its client
    covers the vehicle list, telemetry, status and trips only (no electric
    status, location or health), on `fetch`: importing it would install the
    native module for nothing and still leave half the endpoints to write.
    Read to cross-check the protocol profile.
  - iobroker.toyota 0.4.0 (MIT, 2026-10-07) is an ioBroker adapter (not a
    library, axios + tough-cookie + jsonwebtoken): read to cross-check the
    endpoints (the same) and the sign-in variant (PKCE S256, app 2.25.2).
  - Other npm packages are dead or another API (`toyota-client` 2022 =
    toyota.com US, `node-red-contrib-toyota-myt` 2022 = the old MyT API).
  - So: our own client on `node:https` (~600 lines with the transport; no
    runtime dependency but the SDK, `npm audit` clean), credited in the
    README.
- **Read only in milestone 1** (2026-10-16): the remote commands are not
  confirmed for European cars. Toyota moved `/v1/global/remote/status`,
  `refresh-status` and `electric/status` behind AWS SigV4 (403) between
  July and September 2026 and pytoyoda kept the command route only "pending
  evidence"; ha_toyota added lock/unlock on 2026-09-20 (#329) with no
  European confirmation in its issue #120 and records command answers for
  diagnosis since 2026-10-15 (#468); climate needs `remoteDisplay` 7 and an
  active remote-services subscription (#296) and costs one unit of a
  per-ignition quota per start. Unlocking a car from a home automation is
  also a safety matter: opt-in and checked on a real car first (milestone
  3).
- **A 403 may be the token** (probed 2026-10-16 without any account, with
  the headers of the app and a dummy token): the API answers a bad token
  with HTTP 403 `APIGW-403` "The token was expected to have 3 parts, but got
  0.", the same code as an endpoint a vehicle may not use ("invalid guid and
  vin mapping", pytoyoda fixtures); a missing token is a 401 `APIGW-401`. So
  a 403 gets one new token and one retry unless the token passed a call in
  the last 5 minutes, and only a 403 with a working token sets an endpoint
  aside for a day. The same day, the live sign-in page answered `POST {}`
  with the "Market Locale / Internationalization / UI Locales" round
  recorded by pytoyoda (`e2e/toyota-image-check.sh`).
- **Never wake the car**: no `POST /v1/remote/status` (ha_toyota#229: 12 V
  batteries drained). The values are Toyota's cache; "Last report from the
  car" shows their age.
- **Polling**: 900 s by default, 300 s minimum (Home Assistant: 6 minutes,
  but with ~10 endpoints per car and wake-ups); one request at a time, 1.5 s
  apart (pytoyoda reads sequentially since ha_toyota#282: bursts get 429).
  Our own `setInterval`, devices `should_poll: false` (as guim31's car
  integrations).
- **Mapping** (as guim31/gladys-renault, -stellantis, -tesla, checked
  against the core table): battery `electrical-vehicle-battery/battery-level`,
  electric range `battery-range-estimate`, odometer
  `electrical-vehicle-state/odometer`, doors/boot/bonnet `door-opened` and
  windows `window-opened` (1 = open; not `opening-sensor`, whose enum is
  inverted), locked `lock/binary` read only (an EV command type read only
  shows a raw 0/1), charging `charging-station/charging-state` (charging 0,
  plugged 1, complete or none 4 = idle, as gladys-tesla), plugged
  `electrical-vehicle-charge/plugged`, fuel `level-sensor/liquid-level-percent`,
  fuel and total ranges `distance-sensor/decimal`, charge time
  `duration/integer` minutes, warning lights `counter-sensor/integer`, trip
  fuel `volume-sensor/decimal` litres (Gladys has no L/100 km unit: it is in
  the trip text), position `text/text` "lat, lon" behind an option off by
  default (as guim31). Kilometres only (miles converted).
- **Trip values**: `last-trip-distance` and `last-trip-fuel` go through
  `publishStates` once per trip with `created_at` = its end, so two trips of
  the same length are two points of history; `trip_ended` never fires for
  the first trip read (after a start) nor for an older one.
