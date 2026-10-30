import { createAcpAdapter, type AcpAdapterOptions } from './acp/adapter.js';
import type { AgentAdapter } from './types.js';

export type DshAdapterOptions = Omit<AcpAdapterOptions, 'id' | 'args'> & {
  /** Argumen setelah perintah dasar; default `--profile acp` (docs/ADAPTER_ACP.md). */
  args?: string[];
};

/** Profil dsh yang berbicara ACP lewat stdio. */
export const DSH_ACP_ARGS = ['--profile', 'acp'] as const;

/**
 * DeepSeek Harness lewat ACP. Berjalan di gateway (VPS): cwd terisolasi per run, kunci provider hanya di
 * lingkungan proses gateway, model lewat 9Router. Tidak ada plan/todo/subagent/goal: dsh-acp tidak
 * mengirimnya (docs/ADAPTER_ACP.md, "Yang TIDAK diekspos").
 */
export function createDshAdapter(options: DshAdapterOptions): AgentAdapter {
  return createAcpAdapter({ ...options, id: 'dsh', args: options.args ?? [...DSH_ACP_ARGS] });
}
