'use strict';

const { EventEmitter } = require('node:events');
const path = require('node:path');
const { sha256 } = require('../vault');
const { PreconditionFailed } = require('./errors');

function conflictName(rel, date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const ext = path.posix.extname(rel);
  return `${rel.slice(0, rel.length - ext.length)} (conflito ${stamp})${ext}`;
}

// Three-way sync between the local vault and a remote (S3), using the last synced
// state as the common base. Nothing is ever silently overwritten: when both sides
// changed, the remote version is kept next to the local one as a "conflito" copy.
//
// Emits: 'status' {state: 'syncing'|'idle'|'error', ...}, 'local-changed' [paths], 'conflict' {path, copy}.
class SyncEngine extends EventEmitter {
  constructor({ vault, remote, state }) {
    super();
    this.vault = vault;
    this.remote = remote;
    this.state = state;
    this.queue = Promise.resolve();
  }

  get files() {
    return this.state.files;
  }

  hasBase(rel) {
    return Object.hasOwn(this.files, rel);
  }

  // All sync work runs one task at a time.
  enqueue(task) {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  syncAll() {
    return this.enqueue(() => this.track(async () => {
      const [local, remote] = await Promise.all([this.vault.listFiles(this.files), this.remote.list()]);
      const paths = new Set([...local.keys(), ...remote.keys(), ...Object.keys(this.files)]);
      return this.syncPaths([...paths].sort(), (p) => [local.get(p) ?? null, remote.get(p)?.etag ?? null]);
    }));
  }

  syncFile(rel) {
    return this.enqueue(() => this.track(async () => {
      const [local, remote] = await Promise.all([this.vault.fileInfo(rel, this.files[rel]), this.remote.head(rel)]);
      return this.syncPaths([rel], () => [local, remote?.etag ?? null]);
    }));
  }

  async track(fn) {
    this.emit('status', { state: 'syncing' });
    try {
      const result = await fn();
      this.emit('status', { state: 'idle', at: Date.now() });
      return result;
    } catch (err) {
      this.emit('status', { state: 'error', message: err.message });
      throw err;
    }
  }

  async syncPaths(paths, sides) {
    const changed = [];
    const errors = [];
    for (const p of paths) {
      try {
        const [local, remoteEtag] = sides(p);
        if (await this.syncPath(p, local, remoteEtag)) changed.push(p);
      } catch (err) {
        errors.push(`${p}: ${err.message}`);
      }
    }
    await this.state.save();
    if (changed.length) this.emit('local-changed', changed);
    if (errors.length) throw new Error(errors.join('; '));
    return changed;
  }

  // Returns true when the local vault was modified (download, trash or conflict copy).
  async syncPath(rel, local, remoteEtag, retry = true) {
    const base = this.files[rel];
    const localHash = local?.hash ?? null;
    try {
      if (local && remoteEtag) {
        if (base && localHash === base.hash && remoteEtag === base.etag) return false;
        if (base && remoteEtag === base.etag) {
          await this.upload(rel, { ifMatch: remoteEtag });
          return false;
        }
        if (base && localHash === base.hash) return this.download(rel, localHash);
        return this.resolveBothChanged(rel, localHash);
      }
      if (local) {
        if (base && localHash === base.hash) {
          // Deleted on another device and untouched here.
          await this.vault.trash(rel);
          delete this.files[rel];
          return true;
        }
        await this.upload(rel, { ifNoneMatch: '*' });
        return false;
      }
      if (remoteEtag) {
        if (base && remoteEtag === base.etag) {
          // Deleted here and untouched remotely. With bucket versioning the object stays recoverable.
          await this.remote.delete(rel);
          delete this.files[rel];
          return false;
        }
        return this.download(rel, null);
      }
      delete this.files[rel];
      return false;
    } catch (err) {
      if (!(err instanceof PreconditionFailed) || !retry) throw err;
      // Someone wrote to S3 between our check and our write: re-read both sides once.
      const [fresh, freshLocal] = await Promise.all([this.remote.head(rel), this.vault.fileInfo(rel, this.files[rel])]);
      return this.syncPath(rel, freshLocal, fresh?.etag ?? null, false);
    }
  }

  async resolveBothChanged(rel, localHash) {
    const remote = await this.remote.get(rel);
    if (sha256(remote.body) === localHash) {
      const info = await this.vault.fileInfo(rel);
      this.files[rel] = { ...info, etag: remote.etag };
      return false;
    }
    const copy = conflictName(rel);
    await this.vault.write(copy, remote.body);
    await this.upload(copy, { ifNoneMatch: '*' });
    await this.upload(rel, { ifMatch: remote.etag });
    this.emit('conflict', { path: rel, copy });
    return true;
  }

  async upload(rel, condition) {
    const { body, mtimeMs, size } = await this.vault.readWithStat(rel);
    const { etag } = await this.remote.put(rel, body, condition);
    this.files[rel] = { hash: sha256(body), etag, mtimeMs, size };
  }

  // expectedLocalHash: what the local file must still be (null = must not exist) before overwriting it.
  async download(rel, expectedLocalHash) {
    const { body, etag } = await this.remote.get(rel);
    const current = await this.vault.fileInfo(rel);
    if ((current?.hash ?? null) !== expectedLocalHash) return false; // edited meanwhile; next round decides
    const { mtimeMs, size } = await this.vault.write(rel, body);
    this.files[rel] = { hash: sha256(body), etag, mtimeMs, size };
    return true;
  }
}

module.exports = { SyncEngine, conflictName };
