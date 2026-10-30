import { useState } from 'react';
import { copy } from '../copy';
import { Button } from '../ui/Button';
import { checkForUpdate, type UpdateCheck } from './checkForUpdate';

type State =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'result'; result: UpdateCheck }
  | { phase: 'installing'; version: string }
  | { phase: 'error' };

/** Periksa dan pasang pembaruan aplikasi. Hasil selalu berupa teks, tidak hanya warna. */
export function UpdateSection() {
  const [state, setState] = useState<State>({ phase: 'idle' });
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  const text = copy.settings.update;

  async function check() {
    setState({ phase: 'checking' });
    try {
      setState({ phase: 'result', result: await checkForUpdate() });
    } catch {
      setState({ phase: 'error' });
    }
  }

  async function install(result: Extract<UpdateCheck, { kind: 'available' }>) {
    setState({ phase: 'installing', version: result.version });
    try {
      await result.install();
    } catch {
      setState({ phase: 'error' });
    }
  }

  const result = state.phase === 'result' ? state.result : null;
  let message: string | null = null;
  if (offline) message = text.offline;
  else if (state.phase === 'checking') message = text.checking;
  else if (state.phase === 'installing') message = text.installing(state.version);
  else if (state.phase === 'error') message = text.error;
  else if (result?.kind === 'current') message = text.current;
  else if (result?.kind === 'unavailable') message = text.unavailable;
  else if (result?.kind === 'available') message = text.available(result.version);

  return (
    <section aria-labelledby="settings-update" className="flex flex-col gap-3">
      <h3 id="settings-update" className="text-section font-semibold text-text">
        {text.title}
      </h3>
      <div className="flex items-center gap-3">
        {result?.kind === 'available' ? (
          <Button onClick={() => void install(result)} disabled={offline}>
            {text.install}
          </Button>
        ) : (
          <Button
            variant="secondary"
            onClick={() => void check()}
            disabled={offline || state.phase === 'checking' || state.phase === 'installing'}
          >
            {text.check}
          </Button>
        )}
        <p role="status" className="text-meta text-text-2">
          {message}
        </p>
      </div>
    </section>
  );
}
