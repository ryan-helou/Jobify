import test from 'node:test';
import assert from 'node:assert/strict';

import { pdfProblem } from '../src/config.js';

// Whatever sits at RESUME_PATH is uploaded to real employers and the submission
// cannot be undone, so "the file exists" is not a sufficient check.

const realish = (bytes) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(bytes, 0x20)]);

test('accepts a plausible PDF', () => {
  assert.equal(pdfProblem(realish(8192), 4096), null);
});

test('rejects an empty file', () => {
  assert.match(pdfProblem(Buffer.alloc(0), 4096), /empty/);
});

test('rejects a file that is not a PDF', () => {
  assert.match(pdfProblem(Buffer.from('hello world, not a pdf at all'), 4096), /not a PDF/);
});

test('rejects a placeholder stub that happens to start with %PDF-', () => {
  // This is the exact shape of the stub used during setup, and the old
  // existsSync check waved it straight through to real employers.
  const stub = Buffer.from('%PDF-1.4\nfake\n');
  assert.match(pdfProblem(stub, 4096), /too small|placeholder/);
});

test('rejects a Git LFS pointer left in place of the real file', () => {
  const pointer = Buffer.from('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 123456\n');
  assert.match(pdfProblem(pointer, 4096), /not a PDF/);
});

test('rejects a truncated PDF just under the size floor, accepts it just over', () => {
  // realish(n) prepends a 9-byte header, so total = n + 9.
  assert.match(pdfProblem(realish(4000), 4096), /too small|placeholder/);
  assert.equal(pdfProblem(realish(4100), 4096), null);
});

test('handles null and undefined without throwing', () => {
  assert.match(pdfProblem(null, 4096), /empty/);
  assert.match(pdfProblem(undefined, 4096), /empty/);
});
