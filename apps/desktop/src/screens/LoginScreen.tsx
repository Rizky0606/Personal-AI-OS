import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuthState, useOnline } from '../app/hooks';
import { auth } from '../app/services';
import { copy } from '../copy';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { IconButton } from '../ui/IconButton';
import { TextField } from '../ui/TextField';
import { loginErrorMessage, sanitizeTotp } from './loginErrors';

interface FieldErrors {
  password?: string;
  totp?: string;
}

/**
 * Satu layar: alamat server, password, TOTP. Tanpa langkah "Hubungkan" terpisah.
 * `fixedServer` (alamat tertanam saat build) menyembunyikan isian alamat.
 */
export function LoginScreen({
  initialServer = '',
  fixedServer,
}: {
  initialServer?: string;
  fixedServer?: string;
}) {
  const state = useAuthState();
  const online = useOnline();
  const [server, setServer] = useState(initialServer);
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** Guard sinkron: dua event submit beruntun (klik ganda, Enter) tidak boleh memanggil server dua kali. */
  const inFlight = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  useEffect(() => {
    setServer((current) => current || initialServer);
  }, [initialServer]);

  const expired = state.status === 'signedOut' && state.reason === 'expired';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const errors: FieldErrors = {};
    if (!password) errors.password = copy.login.errors.passwordEmpty;
    if (totp.length !== 6) errors.totp = copy.login.errors.totpFormat;
    setFieldErrors(errors);
    setFormError(null);
    if (errors.password || errors.totp) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      await auth.login(fixedServer ?? server, password, totp);
      // Sesi tersimpan; App yang memindahkan layar. Rahasia dibuang dari memori UI.
      setPassword('');
      setTotp('');
    } catch (error) {
      setFormError(loginErrorMessage(error, online));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-bg p-6">
      <form
        onSubmit={(e) => void submit(e)}
        noValidate
        className="flex w-full max-w-sm flex-col gap-4 rounded-panel border border-border bg-surface p-6"
      >
        <h1 className="text-page font-semibold text-text">{copy.login.title}</h1>
        {formError || expired ? <ErrorBanner message={formError ?? copy.login.expired} /> : null}
        {fixedServer ? null : (
          <TextField
            label={copy.login.server}
            placeholder={copy.login.serverHint}
            value={server}
            onChange={(e) => setServer(e.target.value)}
            disabled={submitting}
            autoComplete="url"
            spellCheck={false}
          />
        )}
        <div className="flex items-end gap-2">
          <TextField
            label={copy.login.password}
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.password}
            disabled={submitting}
            autoComplete="current-password"
            className="w-full"
          />
          <IconButton
            label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
            onClick={() => setShowPassword((v) => !v)}
            className="mb-5 shrink-0"
          >
            {showPassword ? (
              <EyeOff size={16} strokeWidth={1.5} />
            ) : (
              <Eye size={16} strokeWidth={1.5} />
            )}
          </IconButton>
        </div>
        <TextField
          label={copy.login.totp}
          hint={copy.login.totpHint}
          inputMode="numeric"
          value={totp}
          onChange={(e) => setTotp(sanitizeTotp(e.target.value))}
          error={fieldErrors.totp}
          disabled={submitting}
          autoComplete="one-time-code"
        />
        <Button type="submit" variant="primary" disabled={submitting} className="w-full">
          {submitting ? copy.login.submitting : copy.login.submit}
        </Button>
      </form>
    </div>
  );
}
