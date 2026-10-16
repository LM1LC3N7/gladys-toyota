# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- MyToyota account (the e-mail and password of the MyToyota app, or of Lexus
  Link with the Lexus brand), Toyota Connected Services Europe: the session is
  kept in `/data` and renewed with its refresh token, so a restart does not
  sign in again; a refused password is reported and never retried on its own
  (Toyota may lock accounts that insist); a sign-in page that changed is
  reported and tried again every 6 hours.
- One device per car of the account, named after its nickname: fuel level and
  range, battery level and electric range (plug-in hybrids and electric
  cars), total range of plug-in hybrids, odometer, charging state, plugged in,
  charge time remaining, locked, door, boot, bonnet and window open, number of
  warning lights, the last trip (summary, distance and fuel recorded once per
  trip at its end), and when the car last reported. Distances in km.
- Optional parked position (off by default, forgotten when turned off).
- Scene trigger "Trip ended" (distance, duration, fuel, consumption, share
  driven electric, driving score) and scene action "Read the cars now" (all
  cars or one, at most every two minutes).
- Reads every 15 minutes by default (5 minutes minimum), one request at a
  time, only what each car supports; warning lights every 6 hours, the last
  trip when the odometer moved, the list of cars once a day. The car is never
  woken up (its 12 V battery is spared). An endpoint Toyota refuses for a car
  is asked again a day later; a 429 pauses the reads as long as Toyota asks
  (30 minutes otherwise); other failures back off from 5 minutes to an hour.
- "Test the connection" button with a summary of the cars, cloud badges
  marked unreachable when MyToyota is, feature names in French or English.

[Unreleased]: https://github.com/LM1LC3N7/gladys-toyota/commits/main
