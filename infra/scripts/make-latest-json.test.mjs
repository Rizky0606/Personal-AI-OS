import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLatest, githubAssetName } from './make-latest-json.mjs';

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
    // GitHub menyimpan aset dengan spasi diganti titik; URL harus memakai nama itu (bukan %20, yang 404).
    'https://github.com/a/b/releases/download/v1.0.0/Personal.AI.OS_1.0.0_x64-setup.exe',
  );
  assert.equal(out.pub_date, '2026-10-23T00:00:00.000Z');
});

test('nama aset mengikuti normalisasi GitHub', () => {
  assert.equal(
    githubAssetName('Personal AI OS_1.0.4_x64-setup.exe'),
    'Personal.AI.OS_1.0.4_x64-setup.exe',
  );
  assert.equal(githubAssetName('app-release.apk'), 'app-release.apk');
  assert.equal(githubAssetName('a+b (1).exe'), 'a+b..1..exe');
});

test('menolak versi atau tanda tangan tidak valid', () => {
  assert.throws(() => buildLatest({ version: 'v1', repo: 'a/b', installer: 'x', signature: 's' }));
  assert.throws(() =>
    buildLatest({ version: '1.0.0', repo: 'a/b', installer: 'x', signature: ' ' }),
  );
});
