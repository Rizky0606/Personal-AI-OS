import * as Dropdown from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { menuContentClass, menuItemClass } from './menuStyles';

export interface MenuAction {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
}

export interface ActionMenuProps {
  /** Elemen pemicu (tombol); dirender apa adanya lewat asChild. */
  trigger: ReactNode;
  actions: MenuAction[];
}

/** Menu aksi (ubah judul, arsipkan, ...). Navigasi panah, Enter, Esc, dan typeahead dari Radix. */
export function ActionMenu({ trigger, actions }: ActionMenuProps) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={4} className={menuContentClass}>
          {actions.map((action) => (
            <Dropdown.Item
              key={action.id}
              onSelect={action.onSelect}
              className={cn(menuItemClass, action.danger && 'text-danger')}
            >
              {action.icon}
              <span className="min-w-0 flex-1 truncate">{action.label}</span>
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
