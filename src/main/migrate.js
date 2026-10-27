'use strict';

const fs = require('node:fs');
const path = require('node:path');

// The app was called "Docs" before DocX: its userData folder (config.json, preferences, layout and
// favorites in Local Storage) is copied once to the new folder. Runs before Chromium opens any file
// there, and never overwrites a folder that already has a configuration. The old folder is kept.
function migrateUserData(from, to) {
  if (path.resolve(from).toLowerCase() === path.resolve(to).toLowerCase()) return false;
  if (!fs.existsSync(path.join(from, 'config.json'))) return false;
  if (fs.existsSync(path.join(to, 'config.json'))) return false;
  fs.cpSync(from, to, { recursive: true, force: false, errorOnExist: false });
  return true;
}

module.exports = { migrateUserData };
