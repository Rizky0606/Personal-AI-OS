import { writeFileSync } from 'node:fs';
import { serializeOpenApiDocument } from './document.js';

// src/openapi/cli.ts dan dist/openapi/cli.js sama-sama dua tingkat di bawah akar paket.
const target = new URL('../../openapi.json', import.meta.url);
writeFileSync(target, serializeOpenApiDocument());
console.log(`openapi.json ditulis ke ${target.pathname}`);
