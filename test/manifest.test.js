// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULTS, LANGUAGES } from '../src/config.js';
import { ACTIONS, BRANDS, POLL_INTERVAL, SCENE_ACTIONS, SCENE_TRIGGERS } from '../src/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');
const app = read('src/app.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      yield* texts(entry, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

const byKey = (list) => Object.fromEntries(list.map((entry) => [entry.key, entry]));

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.match(
    manifest.gladys_version,
    /^>=5\.1\.0$/,
    'scene triggers and actions need Gladys 5.1',
  );
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-toyota:${manifest.version}`);
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/LM1LC3N7/gladys-toyota/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(docs, /not\s+affiliated\s+with\s+Toyota|sans\s+lien\s+avec\s+Toyota/i);
  }
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
});

test('the configuration matches the code', () => {
  const fields = byKey(manifest.config_schema);
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    assert.deepEqual(fields[key].default, value, key);
  }
  assert.deepEqual(
    fields.language.options.map((o) => o.value),
    LANGUAGES,
  );
  assert.deepEqual(
    fields.brand.options.map((o) => o.value),
    Object.keys(BRANDS),
  );
  assert.equal(fields.email.type, 'string');
  assert.equal(fields.password.type, 'secret', 'the password is never sent back to the browser');
  assert.equal(fields.email.required && fields.password.required, true);
  assert.equal(fields.gps.type, 'boolean');
  assert.equal(fields.gps.default, false, 'the position is personal data: off by default');
  const range = (f) => [f.min, f.max];
  assert.deepEqual(range(fields.poll_interval), [POLL_INTERVAL.min, POLL_INTERVAL.max]);
  assert.ok(POLL_INTERVAL.min >= 300, 'never faster than 5 minutes: Toyota rate-limits');
  const intro = fields.intro;
  assert.equal(intro.type, 'section');
  for (const lang of ['en', 'fr']) {
    assert.ok(intro.description[lang].length <= 1000, `intro.${lang} over 1000 characters`);
    assert.match(intro.description[lang], /MyToyota/);
  }
  assert.ok(intro.links.length <= 5 && intro.links.every((l) => l.url.startsWith('https://')));
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  for (const name of Object.keys(SCENE_ACTIONS)) {
    assert.ok(
      handlers.includes(`onSceneAction(SCENE_ACTIONS.${name}`),
      `SCENE_ACTIONS.${name} has no handler`,
    );
  }
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  assert.ok(!handlers.includes('onSetValue'), 'read only: no command yet');
});

test('the scene action fields and outputs are the ones the code reads and returns', () => {
  const refresh = byKey(manifest.scene_actions)[SCENE_ACTIONS.REFRESH];
  assert.deepEqual(
    refresh.fields.map((f) => f.key),
    ['vehicle'],
  );
  assert.ok(app.includes('fields.vehicle'));
  assert.equal(refresh.fields[0].source, 'devices');
  assert.equal(refresh.fields[0].required, false);
  assert.deepEqual(
    refresh.outputs.map((o) => o.key),
    ['read_at'],
  );
  assert.match(app, /read_at:/);
  assert.ok(refresh.timeout_seconds >= 30 && refresh.timeout_seconds <= 120);
});

test('the trigger fields and variables are what the event carries', () => {
  const trigger = byKey(manifest.scene_triggers)[SCENE_TRIGGERS.TRIP_ENDED];
  const declared = [...trigger.fields, ...trigger.variables].map((f) => f.key);
  const [data] = [
    ...app.matchAll(/pushSceneEvent\(SCENE_TRIGGERS\.TRIP_ENDED, \{([\s\S]*?)\}\);/g),
  ].map((m) => m[1]);
  assert.ok(data, 'the trip_ended event is sent');
  const sent = [...data.matchAll(/^\s+([a-z_0-9]+):/gm)].map((m) => m[1]);
  assert.deepEqual(sent.sort(), declared.sort());
  assert.equal(trigger.fields[0].key, 'vehicle');
  assert.equal(trigger.fields[0].source, 'devices');
  for (const variable of trigger.variables) {
    assert.ok(['string', 'number'].includes(variable.type));
  }
});
