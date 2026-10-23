import { QueryClient } from '@tanstack/react-query';

/** Satu cache untuk seluruh aplikasi; dikosongkan saat keluar supaya data akun lama tidak tersisa. */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
});
