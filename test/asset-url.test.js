'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { assetUrl, assetPathFromUrl, ASSET_SCHEME } = require('../src/shared/asset-url');

test('assetUrl encodes each path segment under the app scheme', () => {
  assert.equal(ASSET_SCHEME, 'vault-asset');
  assert.equal(assetUrl('Pasta/Terminus SFTP.png'), 'vault-asset://local/Pasta/Terminus%20SFTP.png');
  assert.equal(assetUrl('a#b?.png'), 'vault-asset://local/a%23b%3F.png');
});

test('assetPathFromUrl round-trips assetUrl', () => {
  for (const rel of ['x.png', 'Pasta/Terminus SFTP.png', 'çãé/100%.jpg', 'a#b.png']) {
    assert.equal(assetPathFromUrl(assetUrl(rel)), rel);
  }
});

test('assetPathFromUrl rejects other hosts, traversal and encoded separators', () => {
  assert.equal(assetPathFromUrl('vault-asset://other/x.png'), null);
  assert.equal(assetPathFromUrl('https://local/x.png'), null);
  assert.equal(assetPathFromUrl('vault-asset://local/'), null);
  assert.equal(assetPathFromUrl('vault-asset://local/a/%2E%2E/%2E%2E/x.png'), null);
  assert.equal(assetPathFromUrl('vault-asset://local/a%2F..%2F..%2Fx.png'), null);
  assert.equal(assetPathFromUrl('vault-asset://local/a%5C..%5Cx.png'), null);
  assert.equal(assetPathFromUrl('vault-asset://local/a%00.png'), null);
  assert.equal(assetPathFromUrl('vault-asset://local/%E0%A4%A.png'), null);
  assert.equal(assetPathFromUrl('not a url'), null);
  // Windows: alternate data streams and characters invalid in file names.
  assert.equal(assetPathFromUrl('vault-asset://local/nota.md%3Aevil.png'), null);
  assert.equal(assetPathFromUrl('vault-asset://local/C%3A/x.png'), null);
  assert.equal(assetPathFromUrl('vault-asset://local/a%7Cb.png'), null);
});
