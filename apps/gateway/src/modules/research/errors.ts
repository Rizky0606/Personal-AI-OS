/** Kegagalan di pipeline riset dengan kode stabil; `retryable` untuk klien yang ingin mengulang. */
export class ResearchError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ResearchError';
  }
}

/** Dibatalkan pemilik (bukan kegagalan). */
export class ResearchCancelled extends Error {
  constructor() {
    super('Riset dibatalkan.');
    this.name = 'ResearchCancelled';
  }
}
