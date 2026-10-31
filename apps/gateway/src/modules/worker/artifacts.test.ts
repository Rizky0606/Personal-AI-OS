import { describe, expect, it } from 'vitest';
import { parseScreenshotUpload } from './artifacts.js';

describe('worker screenshot upload validation', () => {
  it('accepts exact PNG signature and run metadata', () => {
    const value = parseScreenshotUpload(
      Buffer.from('89504e470d0a1a0a72657374', 'hex'),
      '{"runId":"0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e90"}',
    );
    expect(value.runId).toBe('0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e90');
  });
  it('rejects non-PNG and oversized payloads', () => {
    expect(() =>
      parseScreenshotUpload(
        Buffer.from('not png'),
        '{"runId":"0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e90"}',
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_png' }));
    expect(() =>
      parseScreenshotUpload(
        Buffer.alloc(10 * 1024 * 1024 + 1),
        '{"runId":"0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e90"}',
      ),
    ).toThrow(expect.objectContaining({ code: 'screenshot_too_large' }));
  });
});
