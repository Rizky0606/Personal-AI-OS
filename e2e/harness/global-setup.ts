import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { startStack, type Stack } from './stack.js';

let stack: Stack | undefined;

/** Menyalakan stack sekali untuk seluruh uji; alamatnya diteruskan ke proses tes lewat env dan berkas. */
export default async function globalSetup() {
  stack = await startStack();
  process.env.E2E_CONTROL_URL = stack.controlUrl;
  writeFileSync(
    path.join(import.meta.dirname, '..', '.stack.json'),
    JSON.stringify({ controlUrl: stack.controlUrl }),
  );
  return async () => {
    await stack?.stop();
  };
}
