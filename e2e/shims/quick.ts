/*
 * Pengganti modul Tauri multi-jendela untuk E2E (event, window, plugin-global-shortcut). Quick Ask hanya aktif
 * bila ada label jendela Tauri, yang tidak dimiliki halaman E2E, jadi fungsi ini tidak pernah dipanggil.
 */
const unavailable = (name: string) => () =>
  Promise.reject(new Error(`E2E: ${name} tidak tersedia (Quick Ask hanya di jendela Tauri).`));

export const listen = unavailable('event.listen');
export const emitTo = unavailable('event.emitTo');
export const register = unavailable('globalShortcut.register');
export const unregister = unavailable('globalShortcut.unregister');
export const isRegistered = unavailable('globalShortcut.isRegistered');
export const getCurrentWindow = () => ({ hide: unavailable('window.hide') });
export const Window = { getByLabel: unavailable('Window.getByLabel') };
