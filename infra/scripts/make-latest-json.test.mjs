import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLatest } from './make-latest-json.mjs';

test('latest.json memuat versi, url rilis, dan tanda tangan', () => {
  const out = buildLatest({
    version: '1.0.0',
    repo: 'a/b',
    installer: 'Personal AI OS_1.0.0_x64-setup.exe',
    signature: 'SIG\n',
    now: new Date('2026-10-23T00:00:00Z'),
  });
  assert.equal(out.version, '1.0.0');
  assert.equal(out.platforms['windows-x86_64'].signature, 'SIG');
  assert.equal(
    out.platforms['windows-x86_64'].url,
    'https://github.com/a/b/releases/download/v1.0.0/Personal%20AI%20OS_1.0.0_x64-setup.exe',
  );
  assert.equal(out.pub_date, '2026-10-23T00:00:00.000Z');
});

test('menolak versi atau tanda tangan tidak valid', () => {
  assert.throws(() => buildLatest({ version: 'v1', repo: 'a/b', installer: 'x', signature: 's' }));
  assert.throws(() =>
    buildLatest({ version: '1.0.0', repo: 'a/b', installer: 'x', signature: ' ' }),
  );
});
