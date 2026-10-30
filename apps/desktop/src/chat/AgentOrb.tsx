import type { ActivityPhase } from '../realtime/activity';

export type OrbState = 'idle' | 'thinking' | 'tool' | 'writing' | 'done' | 'error';

export function orbStateOf(phase: ActivityPhase): OrbState {
  if (phase === 'waiting_approval') return 'tool';
  if (phase === 'cancelled') return 'idle';
  return phase;
}

export interface AgentOrbProps {
  state: OrbState;
  size?: 16 | 28;
}

export function AgentOrb({ state, size = 28 }: AgentOrbProps) {
  return (
    <svg
      data-testid="agent-orb"
      data-state={state}
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 28 28"
      className={`aios-agent-orb aios-agent-orb-${state}`}
      role="img"
    >
      <circle cx="14" cy="14" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="14" cy="14" r="4" fill="currentColor" opacity="0.8" />
      {state === 'done' ? (
        <path data-orb-check="true" pathLength="1" d="m8 14 4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2" />
      ) : null}
    </svg>
  );
}
