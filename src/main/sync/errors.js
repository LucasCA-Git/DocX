'use strict';

// The remote object changed since we last saw it (S3 conditional write returned 412/409).
class PreconditionFailed extends Error {
  constructor(key) {
    super(`O objeto remoto mudou: ${key}`);
    this.name = 'PreconditionFailed';
  }
}

module.exports = { PreconditionFailed };
