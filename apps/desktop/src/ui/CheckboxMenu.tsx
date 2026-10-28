import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { menuContentClass, menuItemClass } from './menuStyles';

export interface CheckboxOption {
  value: string;
  label: string;
}

export interface CheckboxMenuProps {
  trigger: ReactNode;
  /** Nama menu untuk pembaca layar. */
  label: string;
  values: readonly string[];
  onValuesChange: (values: string[]) => void;
  options: CheckboxOption[];
  align?: 'start' | 'end';
}

/** Pemilih beberapa nilai dari daftar (paket skill). Menu tetap terbuka saat memilih. */
export function CheckboxMenu({
  trigger,
  label,
  values,
  onValuesChange,
  options,
  align = 'start',
}: CheckboxMenuProps) {
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
          {options.map((option) => (
            <Dropdown.CheckboxItem
              key={option.value}
              checked={values.includes(option.value)}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(on) =>
                onValuesChange(
                  on ? [...values, option.value] : values.filter((v) => v !== option.value),
                )
              }
              className={menuItemClass}
            >
              <span className="size-4 shrink-0">
                <Dropdown.ItemIndicator>
                  <Check size={16} strokeWidth={1.5} aria-hidden="true" />
                </Dropdown.ItemIndicator>
              </span>
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
            </Dropdown.CheckboxItem>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
