const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');

test('all template images declare alt and empty alt is reserved for decorative images', () => {
  function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(file) : file.endsWith('.html') ? [file] : [];
    });
  }
  for (const file of walk(path.join(root, 'src'))) {
    for (const image of fs.readFileSync(file, 'utf8').matchAll(/<img\b[^>]*>/g)) {
      assert.match(image[0], /(?:\[alt\]|\balt)=/, file);
      if (/\balt=""/.test(image[0])) assert.match(image[0], /aria-hidden="true"/, file);
    }
  }
});

test('fallback PNG and favicon files have the advertised dimensions', () => {
  for (const [file, width, height] of [['social-preview.png', 1200, 630], ['favicon-32.png', 32, 32], ['apple-touch-icon.png', 180, 180]]) {
    const data = fs.readFileSync(path.join(root, 'src/assets/brand', file));
    assert.equal(data.readUInt32BE(16), width);
    assert.equal(data.readUInt32BE(20), height);
  }
  const icon = fs.readFileSync(path.join(root, 'src/assets/brand/favicon.ico'));
  assert.equal(icon.readUInt16LE(2), 1);
  assert.equal(icon.readUInt16LE(4), 1);
});
