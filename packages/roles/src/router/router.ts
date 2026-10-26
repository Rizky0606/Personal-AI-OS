import type { RouterOutput } from '@aios/contracts';
import type { RolesRegistry } from '../registry.js';
import { parseRouterOutput } from './output.js';
import { buildRouterMessages } from './prompt.js';
import { CONFIDENCE_THRESHOLD, candidateRoles, fallbackRole, isContinuation } from './rules.js';
import type {
  ChatMessage,
  Complete,
  RouteDecision,
  RouteResult,
  RouteSource,
  RouterInput,
} from './types.js';

/** Pilihan manual yang tidak bisa dipenuhi. `code` dipetakan gateway ke respons 400. */
export class RouterRoleError extends Error {
  constructor(
    readonly code: 'unknown_role' | 'role_not_allowed',
    readonly roleId: string,
    message: string,
  ) {
    super(message);
    this.name = 'RouterRoleError';
  }
}

export interface RouterOptions {
  /** Dipanggil per keputusan, supaya hot-reload role langsung berlaku. */
  registry: () => RolesRegistry;
  complete: Complete;
  threshold?: number;
  now?: () => number;
}

export interface Router {
  /** Tidak pernah melempar karena model gagal (jatuh ke `general`); hanya karena pilihan manual tidak sah atau `signal` dibatalkan. */
  route(input: RouterInput, signal?: AbortSignal): Promise<RouteResult>;
}

const MODEL_ECHO_CHARS = 2000;

export function createRouter(options: RouterOptions): Router {
  const { registry: getRegistry, complete, threshold = CONFIDENCE_THRESHOLD } = options;
  const now = options.now ?? (() => performance.now());

  return {
    async route(input, signal) {
      const started = now();
      const registry = getRegistry();
      const candidates = candidateRoles(registry, {
        surface: input.surface,
        hasProject: input.project !== undefined,
      });
      const allowed = new Set(candidates.map((r) => r.id));
      const fallback = fallbackRole(candidates);

      const result = (
        decision: Partial<RouteDecision> & Pick<RouteDecision, 'role' | 'confidence' | 'reason'>,
        source: RouteSource,
        attempts: number,
        rule?: string,
      ): RouteResult => ({
        decision: { needsSplit: false, subtasks: [], ...decision },
        source,
        attempts,
        latencyMs: Math.max(0, Math.round(now() - started)),
        ...(rule ? { rule } : {}),
      });

      // 1. Pilihan manual (chip role) mengalahkan semuanya.
      if (input.manualRole) {
        if (!registry.roles.has(input.manualRole)) {
          throw new RouterRoleError(
            'unknown_role',
            input.manualRole,
            `Role "${input.manualRole}" tidak ada.`,
          );
        }
        if (!allowed.has(input.manualRole)) {
          throw new RouterRoleError(
            'role_not_allowed',
            input.manualRole,
            `Role "${input.manualRole}" butuh project; tanpa project hanya role grup Umum yang bisa dipilih.`,
          );
        }
        return result(
          { role: input.manualRole, confidence: 1, reason: 'Dipilih manual oleh pemilik.' },
          'manual',
          0,
        );
      }

      // 2. Pesan lanjutan pendek memakai role giliran sebelumnya.
      if (input.previousRole && allowed.has(input.previousRole) && isContinuation(input.message)) {
        return result(
          {
            role: input.previousRole,
            confidence: 0.9,
            reason: `Pesan lanjutan mengikuti role sebelumnya (${input.previousRole}).`,
          },
          'rule',
          0,
          'continuation',
        );
      }

      // 3. Router AI: satu kali coba ulang bila JSON tidak valid.
      const base = buildRouterMessages(input, candidates);
      let conversation: ChatMessage[] = base;
      let attempts = 0;
      let lastError = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        attempts++;
        let text: string;
        try {
          text = await complete({ messages: conversation, temperature: 0, signal });
        } catch (err) {
          if (signal?.aborted) throw err;
          return result(
            {
              role: fallback,
              confidence: 0,
              reason: `Router tidak tersedia, memakai role ${fallback}.`,
            },
            'fallback',
            attempts,
          );
        }
        const parsed = parseRouterOutput(text);
        const checked = parsed.ok ? checkRoles(parsed.value, registry) : parsed;
        if (checked.ok) {
          return result(finalize(checked.value, allowed, threshold, fallback), 'ai', attempts);
        }
        lastError = checked.error;
        conversation = [
          ...base,
          { role: 'assistant', content: text.slice(0, MODEL_ECHO_CHARS) },
          {
            role: 'user',
            content: `Balasanmu tidak valid (${checked.error}). Balas ulang hanya dengan satu objek JSON sesuai skema.`,
          },
        ];
      }
      return result(
        {
          role: fallback,
          confidence: 0,
          reason: `Keluaran router tidak valid (${lastError}), memakai role ${fallback}.`,
        },
        'fallback',
        attempts,
      );
    },
  };
}

function checkRoles(
  output: RouterOutput,
  registry: RolesRegistry,
): { ok: true; value: RouterOutput } | { ok: false; error: string } {
  return registry.roles.has(output.role)
    ? { ok: true, value: output }
    : { ok: false, error: `role "${output.role}" tidak dikenal` };
}

/** Menerapkan konteks dan ambang pada keluaran model yang sudah valid. */
function finalize(
  output: RouterOutput,
  allowed: ReadonlySet<string>,
  threshold: number,
  fallback: string,
): Pick<RouteDecision, 'role' | 'confidence' | 'reason' | 'needsSplit' | 'subtasks'> {
  let role = output.role;
  let reason = output.reason.trim() || 'Tanpa alasan dari router.';
  let coerced = false;

  if (!allowed.has(role)) {
    coerced = true;
    reason = `Role ${role} tidak tersedia di konteks ini (tanpa project hanya role Umum). ${reason}`;
    role = fallback;
  } else if (output.confidence < threshold && role !== fallback) {
    coerced = true;
    reason = `Confidence rendah (${output.confidence.toFixed(2)}) untuk ${role}: ${reason}`;
    role = fallback;
  }

  // Pemecahan hanya berlaku bila keputusan utamanya utuh dan ada 2+ sub-tugas pada role yang boleh dipakai.
  const subtasks = output.subtasks.filter((s) => allowed.has(s.role));
  const split =
    output.needs_split && !coerced && output.confidence >= threshold && subtasks.length >= 2;

  return {
    role,
    confidence: output.confidence,
    reason,
    needsSplit: split,
    subtasks: split ? subtasks : [],
  };
}
