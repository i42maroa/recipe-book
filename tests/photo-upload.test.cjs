const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadService } = require('./helpers/load-service.cjs');

function setup({ size = 100, type = 'image/webp', fail = false } = {}) {
  const state = { closed: false, decoded: 0, canvas: null };
  const { optimizePhoto } = loadService('src/app/utils/photo-upload.utils.ts', {}, {
    File,
    createImageBitmap: async () => {
      state.decoded++;
      if (fail) throw Error('Unsupported image');
      return { width: 4000, height: 3000, close() { state.closed = true; } };
    },
    document: { createElement() {
      const canvas = {
        width: 0, height: 0,
        getContext: () => ({ drawImage() {} }),
        toBlob: (done) => done(new Blob(['x'.repeat(size)], { type })),
      };
      state.canvas = canvas;
      return canvas;
    } },
  });
  return { optimizePhoto, state };
}

test('new JPEG photos are scaled to 1600px and uploaded as smaller WebP files', async () => {
  const { optimizePhoto, state } = setup();
  const original = new File(['x'.repeat(1000)], 'photo.jpg', { type: 'image/jpeg', lastModified: 123 });
  const result = await optimizePhoto(original);
  assert.equal(result.type, 'image/webp');
  assert.equal(result.name, 'photo.webp');
  assert.equal(result.size, 100);
  assert.equal(result.lastModified, 123);
  assert.equal(state.canvas.width, 1600);
  assert.equal(state.canvas.height, 1200);
  assert.equal(state.closed, true);
});

test('GIF, WebP and AVIF are kept as-is without decoding or losing animation', async () => {
  const { optimizePhoto, state } = setup();
  for (const type of ['image/gif', 'image/webp', 'image/avif']) {
    const file = new File(['image'], 'photo', { type });
    assert.equal(await optimizePhoto(file), file);
  }
  assert.equal(state.decoded, 0);
});

test('decode failures, unsupported encoders and larger output preserve the original', async () => {
  const file = new File(['x'.repeat(500)], 'photo.png', { type: 'image/png' });
  for (const options of [{ fail: true }, { type: 'image/png' }, { size: 1000 }]) {
    const { optimizePhoto } = setup(options);
    assert.equal(await optimizePhoto(file), file);
  }
});
