import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpuPercent, summarize } from './loadtest.mjs';

test('cpuPercent: bagian non-idle dari selisih dua pembacaan', () => {
  // user nice system idle iowait
  const prev = [100, 0, 100, 700, 100];
  const cur = [200, 0, 200, 750, 150]; // +200 sibuk, +100 idle/iowait
  assert.equal(Math.round(cpuPercent(prev, cur)), 67);
  assert.equal(cpuPercent(prev, prev), 0);
});

test('summarize: rata-rata dan puncak CPU, puncak memori, RSS per proses', () => {
  const s = summarize([
    {
      cpuPercent: 10,
      memTotalMb: 6000,
      memUsedMb: 1000,
      swapUsedMb: 0,
      processRssMb: { gateway: 150, chromium: 0 },
    },
    {
      cpuPercent: 90,
      memTotalMb: 6000,
      memUsedMb: 2500,
      swapUsedMb: 12,
      processRssMb: { gateway: 210, chromium: 400 },
    },
  ]);
  assert.equal(s.cpuAvgPercent, 50);
  assert.equal(s.cpuPeakPercent, 90);
  assert.equal(s.memUsedPeakMb, 2500);
  assert.equal(s.swapUsedPeakMb, 12);
  assert.deepEqual(s.processRssPeakMb, { gateway: 210, chromium: 400 });
  assert.equal(summarize([]), null);
});
