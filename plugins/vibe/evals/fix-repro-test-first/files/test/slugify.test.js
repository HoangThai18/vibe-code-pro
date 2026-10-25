import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slugify.js';

test('bỏ dấu và khoảng trắng', () => {
  assert.equal(slugify('Xin chào Việt Nam!'), 'xin-chao-viet-nam');
});
