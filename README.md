# Personal AI OS

Monorepo aplikasi AI agent pribadi untuk Windows dan Android, gateway, worker lokal, adapter mesin agent, dan paket bersama. Arsitektur serta status runtime: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/VERIFICATION.md](docs/VERIFICATION.md).

## Pengembangan

- Node.js ≥22, pnpm 10.13.1 (`corepack enable` bila perlu).
- `pnpm install`
- `pnpm lint`, `pnpm typecheck`, `pnpm test`
- Desktop E2E: `pnpm --filter @aios/e2e e2e` (butuh Edge/Chrome lokal; layanan uji terisolasi).
- Android: `apps/android/README.md`; build perlu JDK dan Android SDK yang sesuai.

## Operasi dan rilis

- Setup dan status komponen: `docs/VERIFICATION.md`, `docs/SECURITY_OPS.md`.
- Build/rollback: `docs/RELEASE.md`, `docs/RELEASE_NOTES.md`.
- Checklist aksesibilitas manual: `docs/A11Y_CHECKLIST.md`.

Jangan gunakan kredensial produksi untuk tes. Jangan jalankan deploy atau perintah rilis dari mesin pengembangan.
