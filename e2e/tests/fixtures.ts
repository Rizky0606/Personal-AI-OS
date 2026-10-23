import { test as base, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const stack = () =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, '..', '.stack.json'), 'utf8')) as {
    controlUrl: string;
  };

export interface Config {
  gatewayUrl: string;
  password: string;
  hermesAnswer: string;
}

export const control = {
  url: () => stack().controlUrl,
  async config(): Promise<Config> {
    return (await fetch(`${stack().controlUrl}/config`)).json() as Promise<Config>;
  },
  /** omp terpasang di mesin ini? Uji run coding dilewati bila tidak (mis. di CI). */
  async hasOmp(): Promise<boolean> {
    return ((await (await fetch(`${stack().controlUrl}/capabilities`)).json()) as { omp: boolean })
      .omp;
  },
  async totp(): Promise<string> {
    return ((await (await fetch(`${stack().controlUrl}/totp`)).json()) as { code: string }).code;
  },
  async repo(): Promise<string> {
    return ((await (await fetch(`${stack().controlUrl}/repo`)).json()) as { path: string }).path;
  },
  async git(cwd: string, ...args: string[]): Promise<string> {
    const res = await fetch(`${stack().controlUrl}/git`, {
      method: 'POST',
      body: JSON.stringify({ cwd, args }),
    });
    return ((await res.json()) as { out: string }).out;
  },
};

/** Menyiapkan halaman: shim Tauri aktif dan terhubung ke server kendali sebelum aplikasi dimuat. */
export async function prepare(page: Page, options: { pickFolder?: string } = {}) {
  const controlUrl = stack().controlUrl;
  await page.addInitScript(
    ({ controlUrl, pick }) => {
      Object.assign(window, { __TAURI_INTERNALS__: {}, __E2E_CONTROL__: controlUrl });
      if (pick) Object.assign(window, { __E2E_PICK_FOLDER__: pick, __E2E_PICK_FOLDER: pick });
    },
    { controlUrl, pick: options.pickFolder },
  );
}

/** Login lewat UI dengan akun pemilik dan kode TOTP dari server kendali. */
export async function login(page: Page) {
  const config = await control.config();
  await page.goto('/');
  await page.getByLabel('Alamat server').fill(config.gatewayUrl);
  await page.getByLabel('Password', { exact: true }).fill(config.password);
  await page.getByLabel('Kode TOTP').fill(await control.totp());
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Navigasi utama' })).toBeVisible();
}

export const test = base;
export { expect };
