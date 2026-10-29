/**
 * Satu sumber untuk Ctrl+1..6: urutan sama dengan rail (Chat, Project, Kanban, Jadwal, Riset, Pengaturan).
 * Pendengar keyboard, Shell, dan petunjuk di palet perintah semuanya membaca daftar ini.
 */
export const NAV_ROUTES = [
  '/',
  '/workspace',
  '/kanban',
  '/schedules',
  '/research',
  '/settings',
] as const;

export type NavRoute = (typeof NAV_ROUTES)[number];

/** Tujuan untuk Ctrl+<slot> (mulai dari 1); undefined di luar jangkauan. */
export function routeForSlot(slot: number): NavRoute | undefined {
  return NAV_ROUTES[slot - 1];
}

/** Petunjuk pintasan untuk satu layar, mis. "Ctrl+3"; undefined bila layar tidak punya pintasan angka. */
export function shortcutHint(route: string): string | undefined {
  const index = NAV_ROUTES.findIndex((r) => r === route);
  return index < 0 ? undefined : `Ctrl+${index + 1}`;
}
