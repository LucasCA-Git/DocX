'use strict';

const { PreconditionFailed } = require('../src/main/sync/errors');

// In-memory stand-in for S3Remote with the same conditional-write semantics.
class MemoryRemote {
  constructor() {
    this.objects = new Map();
    this.counter = 0;
  }

  async list() {
    return new Map([...this.objects].map(([key, obj]) => [key, { etag: obj.etag }]));
  }

  async head(key) {
    const obj = this.objects.get(key);
    return obj ? { etag: obj.etag } : null;
  }

  async get(key) {
    const obj = this.objects.get(key);
    if (!obj) throw Object.assign(new Error(`NoSuchKey: ${key}`), { name: 'NoSuchKey' });
    return { body: Buffer.from(obj.body), etag: obj.etag };
  }

  async put(key, body, { ifMatch, ifNoneMatch } = {}) {
    const current = this.objects.get(key);
    if (ifNoneMatch === '*' && current) throw new PreconditionFailed(key);
    if (ifMatch && (!current || current.etag !== ifMatch)) throw new PreconditionFailed(key);
    const etag = `etag-${++this.counter}`;
    this.objects.set(key, { body: Buffer.from(body), etag });
    return { etag };
  }

  async delete(key) {
    this.objects.delete(key);
  }

  text(key) {
    return this.objects.get(key)?.body.toString('utf8');
  }
}

module.exports = { MemoryRemote };
