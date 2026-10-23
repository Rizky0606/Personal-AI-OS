// Proses anak yang menjalankan Postgres tertanam untuk tes (dipanggil global-setup.ts).
// Dipisah dari proses Vitest karena embedded-postgres memasang async-exit-hook, yang memanggil
// process.exit() dan menimpa exit code Vitest (tes gagal tetap keluar dengan kode 0).
// Berhenti rapi saat stdin ditutup, termasuk bila proses induk mati mendadak.
import EmbeddedPostgres from 'embedded-postgres';

const [databaseDir, port] = process.argv.slice(2);

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'aios',
  password: 'aios-test',
  port: Number(port),
  persistent: false,
  onLog: () => undefined,
  onError: () => undefined,
});

await pg.initialise();
await pg.start();
process.stdout.write('READY\n');

process.stdin.resume();
process.stdin.on('end', () => {
  pg.stop().finally(() => process.exit(0));
});
