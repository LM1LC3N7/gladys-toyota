# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15), its only
runtime dependency (HTTPS goes through `node:https`). It signs in to MyToyota
(Toyota Connected Services Europe, the cloud of the MyToyota and Lexus Link
apps) with the e-mail and password of the app, reads the cars of the account
and their data on its own clock, turns them into one Gladys device per car,
and fires a scene event when a trip ends. Read only. Unofficial, not
affiliated with Toyota or Lexus.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js            SDK bootstrap only
src/handlers.js     every SDK handler -> the app (shared with the tests)
src/app.js          ToyotaApp: poll loop, per-endpoint errors and pauses,
                    devices, states, trip events, badges, test button, refresh
src/client.js       the account: sign-in (ForgeRock callbacks, authorize, code),
                    refresh, one retry on 401, paced API calls, the headers
src/toyota.js       the only network access (node:https, settles once), errors
src/vehicles.js     API answers -> plain objects (pure)
src/devices.js      -> Gladys devices and states (pure)
src/publisher.js    states within 300/min, trip states and scene events queued
src/store.js        /data/toyota-state.json: the session
src/config.js       config_schema normalized, account key (hash of e-mail + brand)
src/constants.js    sign-in and API constants, Gladys values, keys, limits, timings
src/i18n.js         runtime texts, feature names, trip summary (en/fr)
test/fixtures/      answers adapted from pytoyoda's recorded ones; Gladys table
test/helpers/       a fake MyToyota behind the transport
```

## Rules

- **External ids are forever**: device = `vehicle:<VIN>`, feature =
  `<device>:<role>` with role among `fuel-level`, `battery-level`,
  `electric-range`, `fuel-range`, `total-range`, `odometer`,
  `charging-state`, `plugged`, `charge-time-remaining`, `locked`,
  `door-open`, `boot-open`, `bonnet-open`, `window-open`, `position`,
  `warning-lights`, `last-trip`, `last-trip-distance`, `last-trip-fuel`,
  `last-update`. Never change how they are built.
- Manifest keys (`email`, `password`, `brand` and its values `toyota`/`lexus`,
  `poll_interval`, `gps`, `language`, `test_connection`, the scene action
  `refresh` with `vehicle` and `read_at`, the scene trigger `trip_ended` with
  its field and variables) are frozen: users store them in devices and scenes.
- Value conventions: the Gladys side is the core `server/utils/constants.js`
  (CHARGING_STATION_CHARGING_STATE, LOCK.STATE 1 = locked, door-opened 1 =
  open); the SDK exports the categories, types and units, not the values:
  they are in `src/constants.js`. Distances in km.
- **Never sign in again by itself after a refused password**, never read
  faster than every 5 minutes, one API request at a time, honour
  Retry-After: Toyota rate-limits and may lock accounts. **Never wake the
  car** (`POST /v1/remote/status`) without an explicit user action: it drains
  the 12 V battery. Never add a call outside `ToyotaClient`.
- Never log or put in a status message the password, the tokens, a whole VIN
  (`vinTail()`) or a position.
- Remote commands (lock, unlock, climate, charge) only as an opt-in, after a
  check on a real car (TODO.md, milestone 3).
- Container limits: 256 MB RAM, 0.5 CPU, read-only rootfs, only `/data`
  writable, bridge network. Gladys rate limits: 300 states/min, 300 scene
  events/min.
- Tests never touch the network: the transport is injected
  (`test/toyota.test.js` uses a loopback server for the real one).
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
