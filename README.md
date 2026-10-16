# gladys-toyota

[Gladys Assistant](https://gladysassistant.com) external integration for
**Toyota and Lexus cars in Europe**, through the **MyToyota connected
services** (Toyota Connected Services Europe, the cloud of the MyToyota and
Lexus Link apps). One device per car: fuel level and range, battery level,
electric and total range, charging state, plug and remaining charge time
(hybrids, plug-in hybrids, electric cars), odometer, locks, doors, boot,
bonnet and windows, warning lights, the last trip, an optional parked
position, a "trip ended" scene trigger and a "read the cars now" scene
action. Read only for now. Unofficial, not affiliated with Toyota or Lexus.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **Work in progress (0.1, not published to the store yet).** Tested with
> answers adapted from the recorded ones of pytoyoda, not yet with a real car.
> Feedback and bug reports are welcome in the
> [GitHub issues](https://github.com/LM1LC3N7/gladys-toyota/issues).

North America (Toyota app, another API) is out of scope.

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (ToyotaApp) ⇄ src/client.js ⇄ src/toyota.js ⇄ MyToyota
                                   ├─ src/vehicles.js   API answers -> plain objects (pure)
                                   ├─ src/devices.js    -> Gladys devices and states (pure)
                                   ├─ src/publisher.js  300 states/min, trip states and scene events queued
                                   └─ src/store.js      session (/data)
```

- **Account**: e-mail and password of the app (`secret` field), brand Toyota
  or Lexus (`x-brand`). The sign-in of the app: the ForgeRock callbacks of
  `b2c-login.toyota-europe.com` (`json/realms/root/realms/tme/authenticate`,
  user name then password), the `authorize` redirect with the
  `iPlanetDirectoryPro` cookie, then the token endpoint (authorization code,
  `client_id=oneapp`) returns an access token (~1 hour), a refresh token and
  an id token whose `uuid` claim goes into the `x-guid` header. The tokens
  are kept in `/data`; the access token is renewed with the refresh token, a
  refused refresh falls back once to the password, a 401 gets one new token
  and one retry, and so does a 403 when the token has not passed a call in
  the last 5 minutes (Toyota answers a bad token with 403 APIGW-403, checked
  on 2026-10-16). A refused password is never retried by itself.
- **Reading** (`ctpa-oneapi.tceu-ctp-prd.toyotaconnectedeurope.io`, headers
  of the app, `x-client-ref` = HMAC of the uuid): `GET /v2/vehicle/guid` (the
  cars and their capabilities) at start, once a day and on Scan; per car and
  per round (15 minutes by default, 5 minimum), as its capabilities allow,
  `GET /v3/telemetry`, `/v1/vehicle/electric/status`, `/v1/vehicle/status`,
  `/v1/location` (option); `/v1/vehiclehealth/status` every 6 hours;
  `/v1/trips?…&limit=1` when the odometer moved (and every 6 hours). One
  request at a time, 1.5 s apart. Never `POST /v1/remote/status` (the wake-up
  that drains the 12 V battery): the values are Toyota's cache.
- **Errors**: an endpoint answered 403/404/4xx for a car (with a token that
  works) is left aside for a day, a 5xx for the round; a 429 stops the round and waits for
  `Retry-After` (30 minutes otherwise); network errors back off 5, 10, 15,
  30 then 60 minutes; a sign-in page that answers unexpectedly waits 6
  hours.
- **Devices**: `ext:<selector>:vehicle:<VIN>`, features
  `ext:<selector>:vehicle:<VIN>:<role>`, not polled by Gladys
  (`should_poll: false`). Categories as the car integrations of the store
  (guim31/gladys-renault, -stellantis, -tesla): `electrical-vehicle-*`,
  `lock/binary`, `charging-station/charging-state`, `level-sensor`,
  `distance-sensor`, `duration`, `counter-sensor`, `volume-sensor`, `text`.
- **States**: through `publishChangedStates` (only what changed, every hour
  otherwise); the trip distance and fuel through `publishStates`, once per
  trip, dated at its end. The `trip_ended` scene event fires for a new trip
  (never for the first one read).

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/toyota.js` holds sign-in rounds and API answers adapted from
the recorded ones of pytoyoda (a plug-in hybrid, a hybrid, an electric car);
`test/helpers/fakeToyota.js` serves them behind the transport, sign-in and
tokens included, and checks the headers of the app. The transport itself is
tested against a loopback HTTP server. `test/gladys-rules.test.js` checks the
devices against a table extracted from the Gladys core.

## Credits

The client is our own (`node:https`, no dependency but the SDK), written from
the behaviour documented by these projects (see [TODO.md](TODO.md),
Decisions):

- [pytoyoda](https://github.com/pytoyoda/pytoyoda) (MIT, Simon Hansen and
  contributors), the library of the Home Assistant integration: sign-in
  flow, client ids, API key and headers, endpoints and their 2026 moves,
  capability rules, payload models, the `remainingChargeTime` placeholder,
  sequential requests. The test fixtures are adapted from its recorded
  answers (`tests/unit_tests/data`, `tests/integration_tests/data`).
- [ha_toyota](https://github.com/pytoyoda/ha_toyota) (MIT): polling pace,
  charging statuses, the 12 V battery warning, the remote-service
  findings.
- [node-red-contrib-toyota](https://github.com/fmarzocca/node-red-contrib-toyota)
  (MIT, Fabio Marzocca): a Node implementation of the same sign-in and API,
  read to cross-check the protocol profile.
- [guim31/gladys-renault](https://github.com/guim31/gladys-renault)
  (Apache-2.0): how the store's car integrations map vehicles to Gladys, and
  the Gladys feature table of `test/fixtures/gladys-feature-table.json`.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic is added at the first real release only.

## License

Apache-2.0. Toyota, Lexus, MyToyota and Lexus Link are trademarks of their
owners; this project is not affiliated with Toyota or Lexus.
