'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

// What each file looked like at the last successful sync: {hash, etag, mtimeMs, size}.
// Tied to one bucket/prefix; pointing the vault elsewhere starts from an empty base.
class SyncState {
  constructor(file, remoteId, files = {}) {
    this.file = file;
    this.remoteId = remoteId;
    this.files = files;
  }

  static async load(file, remoteId) {
    try {
      const data = JSON.parse(await fsp.readFile(file, 'utf8'));
      if (data.remoteId === remoteId && data.files && typeof data.files === 'object') {
        return new SyncState(file, remoteId, data.files);
      }
    } catch (err) {
      if (err.code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err;
    }
    return new SyncState(file, remoteId);
  }

  async save() {
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify({ remoteId: this.remoteId, files: this.files }, null, 2));
    await fsp.rename(tmp, this.file);
  }
}

module.exports = { SyncState };
