'use strict';

const {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { fromIni } = require('@aws-sdk/credential-providers');
const { isIgnored } = require('../vault');
const { PreconditionFailed } = require('./errors');

const normalizeEtag = (etag) => (etag ? etag.replace(/"/g, '') : null);
const hasStatus = (err, code) => err?.$metadata?.httpStatusCode === code;

function contentType(rel) {
  if (/\.(md|markdown)$/i.test(rel)) return 'text/markdown; charset=utf-8';
  if (/\.txt$/i.test(rel)) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

// Remote side of the sync: one object per note under <bucket>/<prefix>/.
// Credentials come from the AWS CLI profile (~/.aws), never from the renderer.
class S3Remote {
  constructor({ bucket, prefix = '', region, profile }) {
    this.bucket = bucket;
    this.prefix = prefix ? `${prefix.replace(/^\/+|\/+$/g, '')}/` : '';
    // followRegionRedirects: a wrong region in the settings still reaches the bucket.
    this.client = new S3Client({
      region,
      followRegionRedirects: true,
      credentials: profile ? fromIni({ profile }) : undefined,
    });
  }

  key(rel) {
    return this.prefix + rel;
  }

  async list() {
    const out = new Map();
    let token;
    do {
      const res = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: this.prefix || undefined,
        ContinuationToken: token,
      }));
      for (const obj of res.Contents ?? []) {
        const rel = obj.Key.slice(this.prefix.length);
        if (!rel || rel.endsWith('/') || isIgnored(rel)) continue;
        out.set(rel, { etag: normalizeEtag(obj.ETag) });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  async head(rel) {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(rel) }));
      return { etag: normalizeEtag(res.ETag) };
    } catch (err) {
      if (hasStatus(err, 404) || err.name === 'NotFound') return null;
      throw err;
    }
  }

  async get(rel) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(rel) }));
    return { body: Buffer.from(await res.Body.transformToByteArray()), etag: normalizeEtag(res.ETag) };
  }

  // ifMatch / ifNoneMatch use S3 conditional writes so a newer remote version is never clobbered.
  async put(rel, body, { ifMatch, ifNoneMatch } = {}) {
    try {
      const res = await this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(rel),
        Body: body,
        ContentType: contentType(rel),
        IfMatch: ifMatch ? `"${ifMatch}"` : undefined,
        IfNoneMatch: ifNoneMatch,
      }));
      return { etag: normalizeEtag(res.ETag) };
    } catch (err) {
      if (hasStatus(err, 412) || hasStatus(err, 409) || err.name === 'PreconditionFailed') {
        throw new PreconditionFailed(rel);
      }
      throw err;
    }
  }

  async delete(rel) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(rel) }));
  }
}

module.exports = { S3Remote };
