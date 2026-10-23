import { writeFileSync } from 'node:fs';
import { generateCss } from './css.js';
import { generateKotlin } from './kotlin.js';
import { loadTokens } from './tokens.js';

// Dijalankan dari src/ (tes) atau dist/ (build); keduanya satu tingkat di bawah akar paket.
const tokens = loadTokens();
writeFileSync(new URL('../tokens.css', import.meta.url), generateCss(tokens));
writeFileSync(new URL('../Tokens.kt', import.meta.url), generateKotlin(tokens));
console.log('tokens.css dan Tokens.kt ditulis');
