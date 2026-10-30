import { copy } from '../copy';
import { useUiStore, type ThemeMode } from '../state/uiStore';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Switch } from '../ui/Switch';

const themes: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: copy.settings.themeSystem },
  { value: 'light', label: copy.settings.themeLight },
  { value: 'dark', label: copy.settings.themeDark },
];

const systemReduces = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Tema terang/gelap/sistem dan "kurangi gerakan" (bawaan mengikuti sistem). */
export function AppearanceSettings() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const reduceMotion = useUiStore((s) => s.reduceMotion);
  const setReduceMotion = useUiStore((s) => s.setReduceMotion);
  const effective = reduceMotion ?? systemReduces();

  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-ui text-text">{copy.settings.theme}</p>
        <div className="flex gap-2">
          {themes.map((t) => (
            <Chip key={t.value} selected={theme === t.value} onClick={() => setTheme(t.value)}>
              {t.label}
            </Chip>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-ui text-text">{copy.settings.reduceMotion}</span>
          <span className="text-meta text-text-2">
            {reduceMotion === null ? copy.settings.reduceMotionSystem : copy.settings.reduceMotionHint}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {reduceMotion === null ? null : (
            <Button variant="ghost" onClick={() => setReduceMotion(null)}>
              {copy.settings.reduceMotionReset}
            </Button>
          )}
          <Switch
            label={copy.settings.reduceMotion}
            checked={effective}
            onChange={(on) => setReduceMotion(on)}
          />
        </div>
      </div>
    </>
  );
}
