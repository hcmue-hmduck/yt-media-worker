import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMetadata } from '../media-utils.js';
test('accepts the 21-minute sample but rejects live, missing duration and oversized jobs', () => {
  assert.doesNotThrow(() => validateMetadata({ duration: 1272 }));
  for (const metadata of [{ duration: 1272, is_live: true }, { duration: 1272, was_live: true }, {}, { duration: 1801 }]) {
    assert.throws(() => validateMetadata(metadata));
  }
});
