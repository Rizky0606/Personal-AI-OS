import { lookup as dnsLookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { ResearchError } from './errors.js';

/**
 * Pengambilan halaman riset memakai URL dari hasil pencarian, jadi tidak boleh bisa menjangkau layanan
 * internal: gateway berjalan di host yang sama dengan Hermes, 9Router, Postgres, dan SearXNG (hanya localhost).
 */
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

/** true bila alamat IP bisa dijangkau dari internet publik. IPv4-mapped IPv6 dinilai sebagai IPv4-nya. */
export function isPublicIp(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const ip = mapped?.[1] ?? address;
  const family = isIP(ip);
  if (family === 0) return false;
  return !blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

export interface UrlPolicy {
  /** Hanya untuk tes dengan server palsu di 127.0.0.1. Tidak ada env yang membukanya di produksi. */
  allowPrivateHosts?: boolean;
}

const blockedUrl = (why: string) => new ResearchError('url_blocked', `URL ditolak: ${why}.`);

/** Memeriksa skema, kredensial, dan host literal. Nama host diperiksa saat koneksi lewat `guardedLookup`. */
export function assertFetchableUrl(raw: string, policy: UrlPolicy = {}): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw blockedUrl('bukan URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw blockedUrl('skema bukan http/https');
  if (url.username || url.password) throw blockedUrl('mengandung kredensial');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    if (!policy.allowPrivateHosts) throw blockedUrl('host lokal');
  }
  if (isIP(host) !== 0 && !policy.allowPrivateHosts && !isPublicIp(host)) {
    throw blockedUrl('alamat IP privat');
  }
  return url;
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | { address: string; family: number }[],
  family?: number,
) => void;

/**
 * `lookup` untuk node:http(s): menolak bila SALAH SATU alamat hasil DNS privat. Pemeriksaan terjadi pada
 * saat koneksi, jadi DNS rebinding (nama yang berpindah ke IP internal setelah dicek) tidak lolos.
 */
export function guardedLookup(policy: UrlPolicy = {}) {
  return (hostname: string, options: object, callback: LookupCallback): void => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, []);
      const list = addresses as { address: string; family: number }[];
      if (!policy.allowPrivateHosts && list.some((a) => !isPublicIp(a.address))) {
        const blockedError: NodeJS.ErrnoException = Object.assign(
          new Error('alamat privat ditolak'),
          { code: 'EBLOCKED' },
        );
        return callback(blockedError, []);
      }
      const wantsAll = (options as { all?: boolean }).all === true;
      if (wantsAll) return callback(null, list);
      const first = list[0];
      if (!first) return callback(new Error('DNS kosong'), []);
      return callback(null, first.address, first.family);
    });
  };
}

/** Pemeriksaan DNS sekali (tanpa koneksi), untuk browser yang membuka koneksinya sendiri. */
export async function assertPublicHost(url: URL, policy: UrlPolicy = {}): Promise<void> {
  if (policy.allowPrivateHosts) return;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0) {
    if (!isPublicIp(host)) throw blockedUrl('alamat IP privat');
    return;
  }
  const addresses = await new Promise<{ address: string }[]>((resolve, reject) => {
    dnsLookup(host, { all: true }, (err, list) => (err ? reject(err) : resolve(list)));
  });
  if (addresses.length === 0 || addresses.some((a) => !isPublicIp(a.address))) {
    throw blockedUrl('host mengarah ke alamat privat');
  }
}
