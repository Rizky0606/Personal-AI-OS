/**
 * Tipe minimal untuk jsdom. Paket @types/jsdom memuat `lib="dom"` ke seluruh proyek sehingga tipe global
 * Node (fetch, ReadableStream) berubah; yang dipakai gateway hanya bagian kecil ini.
 */
declare module 'jsdom' {
  export class VirtualConsole {}

  interface JsdomElement {
    getAttribute(name: string): string | null;
  }

  interface JsdomDocument {
    title: string;
    body: { textContent: string | null } | null;
    querySelector(selector: string): JsdomElement | null;
  }

  export class JSDOM {
    constructor(html?: string, options?: { url?: string; virtualConsole?: VirtualConsole });
    readonly window: { readonly document: JsdomDocument; close(): void };
  }
}
