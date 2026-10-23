import * as Dialog from '@radix-ui/react-dialog';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';

/** Palet perintah (Ctrl+K). Kosong dulu; perintah ditambah fase berikutnya. */
export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-bg/60" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-24 left-1/2 z-50 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 rounded-panel border border-border bg-surface p-4 shadow-float"
        >
          <Dialog.Title className="text-section font-semibold text-text">
            {copy.shell.palette}
          </Dialog.Title>
          <p className="mt-2 text-ui text-text-2">{copy.shell.paletteHint}</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
