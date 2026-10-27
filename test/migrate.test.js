'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { migrateUserData } = require('../src/main/migrate');

function tempDirs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-migrate-'));
  return { from: path.join(base, 'docs'), to: path.join(base, 'DocX') };
}

test('copies the old app folder (config, prefs, local storage) when the new one is missing', () => {
  const { from, to } = tempDirs();
  fs.mkdirSync(path.join(from, 'Local Storage'), { recursive: true });
  fs.writeFileSync(path.join(from, 'config.json'), '{"vaultPath":"C:\\\\notas"}');
  fs.writeFileSync(path.join(from, 'Local Storage', 'leveldb'), 'x');
  assert.equal(migrateUserData(from, to), true);
  assert.equal(fs.readFileSync(path.join(to, 'config.json'), 'utf8'), '{"vaultPath":"C:\\\\notas"}');
  assert.equal(fs.readFileSync(path.join(to, 'Local Storage', 'leveldb'), 'utf8'), 'x');
  assert.ok(fs.existsSync(path.join(from, 'config.json')), 'the old folder is kept');
});

test('never overwrites a configured new folder', () => {
  const { from, to } = tempDirs();
  fs.mkdirSync(from, { recursive: true });
  fs.mkdirSync(to, { recursive: true });
  fs.writeFileSync(path.join(from, 'config.json'), 'old');
  fs.writeFileSync(path.join(to, 'config.json'), 'new');
  assert.equal(migrateUserData(from, to), false);
  assert.equal(fs.readFileSync(path.join(to, 'config.json'), 'utf8'), 'new');
});

test('does nothing without an old configuration or when both paths are the same folder', () => {
  const { from, to } = tempDirs();
  assert.equal(migrateUserData(from, to), false);
  assert.equal(fs.existsSync(to), false);
  fs.mkdirSync(from, { recursive: true });
  fs.writeFileSync(path.join(from, 'config.json'), 'old');
  assert.equal(migrateUserData(from, from), false);
});
