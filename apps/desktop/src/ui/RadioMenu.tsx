import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { menuContentClass, menuItemClass } from './menuStyles';

export interface RadioOption {
  value: string;
  label: string;
  hint?: string;
  /** Tidak bisa dipilih; `description` menjelaskan alasannya. */
  disabled?: boolean;
  /** Keterangan di bawah label (mis. alasan nonaktif). */
  description?: string;
}

export interface RadioMenuProps {
  trigger: ReactNode;
  /** Nama menu untuk pembaca layar. */
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: RadioOption[];
  align?: 'start' | 'end';
}

/** Pemilih satu nilai dari daftar (role, model). */
export function RadioMenu({
  trigger,
  label,
  value,
  onValueChange,
  options,
  align = 'start',
}: RadioMenuProps) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align={align}
          sideOffset={4}
          aria-label={label}
          className={cn(menuContentClass, 'max-h-80 overflow-y-auto')}
        >
          <Dropdown.RadioGroup value={value} onValueChange={onValueChange}>
            {options.map((option) => (
              <Dropdown.RadioItem
                key={option.value}
                value={option.value}
                disabled={option.disabled ?? false}
                title={option.description}
                className={
                  option.description
                    ? menuItemClass.replace('h-8', 'min-h-8 py-1.5')
                    : menuItemClass
                }
              >
                <span className="size-4 shrink-0">
                  <Dropdown.ItemIndicator>
                    <Check size={16} strokeWidth={1.5} aria-hidden="true" />
                  </Dropdown.ItemIndicator>
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{option.label}</span>
                  {option.description ? (
                    <span className="text-caption text-text-3">{option.description}</span>
                  ) : null}
                </span>
                {option.hint ? (
                  <span className="shrink-0 font-mono text-caption text-text-3">{option.hint}</span>
                ) : null}
              </Dropdown.RadioItem>
            ))}
          </Dropdown.RadioGroup>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
