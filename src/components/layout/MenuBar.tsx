import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { openUrl } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import clsx from 'clsx';
import { DISCORD_URL } from '../../config/links';
import { APP_VERSION } from '../../version';

interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  separator?: boolean;
}

interface MenuDef {
  id: string;
  label: string;
  items: MenuItem[];
}

const GITHUB_URL = 'https://github.com/TabularisDB/tabularis';

export const MenuBar = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const dispatchEvent = useCallback((name: string) => {
    window.dispatchEvent(new CustomEvent(name));
  }, []);

  const close = useCallback(() => setOpenMenuId(null), []);

  // Close on outside click and Escape
  useEffect(() => {
    if (!openMenuId) return;
    const onMouseDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        close();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenuId, close]);

  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const mod = isMac ? '⌘' : 'Ctrl';

  const menus: MenuDef[] = [
    {
      id: 'file',
      label: t('menuBar.file'),
      items: [
        {
          label: t('menuBar.openConnections'),
          shortcut: `${mod}+⇧+C`,
          action: () => navigate('/connections'),
        },
        {
          label: t('menuBar.newConnection'),
          shortcut: `${mod}+⇧+N`,
          action: () => navigate('/connections', { state: { openNew: true } }),
        },
        { separator: true, label: '' },
        {
          label: t('menuBar.settings'),
          shortcut: `${mod}+,`,
          action: () => navigate('/settings'),
        },
      ],
    },
    {
      id: 'view',
      label: t('menuBar.view'),
      items: [
        {
          label: t('menuBar.toggleSidebar'),
          shortcut: `${mod}+B`,
          action: () => dispatchEvent('tabularis:toggle-sidebar'),
        },
        {
          label: t('menuBar.toggleRightPanel'),
          shortcut: `${mod}+I`,
          action: () => dispatchEvent('tabularis:toggle-right-panel'),
        },
        { separator: true, label: '' },
        {
          label: t('menuBar.commandPalette'),
          shortcut: `${mod}+K`,
          action: () => dispatchEvent('tabularis:open-command-palette'),
        },
      ],
    },
    {
      id: 'tools',
      label: t('menuBar.tools'),
      items: [
        {
          label: t('menuBar.mcpServer'),
          action: () => navigate('/mcp'),
        },
        {
          label: t('menuBar.taskManager'),
          action: () => {
            void invoke('open_task_manager_window').catch((err) => {
              console.error('Failed to open task manager window', err);
            });
          },
        },
        { separator: true, label: '' },
        {
          label: t('menuBar.schemaDiagram'),
          action: () => navigate('/schema-diagram'),
        },
        {
          label: t('menuBar.visualExplain'),
          action: () => navigate('/visual-explain'),
        },
      ],
    },
    {
      id: 'help',
      label: t('menuBar.help'),
      items: [
        {
          label: t('menuBar.documentation'),
          action: () => openUrl(GITHUB_URL),
        },
        {
          label: t('menuBar.discord'),
          action: () => openUrl(DISCORD_URL),
        },
        { separator: true, label: '' },
        {
          label: t('menuBar.aboutVersion', { version: APP_VERSION }),
          disabled: true,
        },
      ],
    },
  ];

  const handleTriggerEnter = (id: string) => {
    if (openMenuId !== null && openMenuId !== id) setOpenMenuId(id);
  };

  return (
    <div
      ref={barRef}
      className="h-7 bg-elevated border-b border-default flex items-center px-1 shrink-0 select-none relative z-30"
    >
      {menus.map((menu) => {
        const isOpen = openMenuId === menu.id;
        return (
          <div key={menu.id} className="relative">
            <button
              onClick={() => setOpenMenuId(isOpen ? null : menu.id)}
              onMouseEnter={() => handleTriggerEnter(menu.id)}
              className={clsx(
                'h-6 px-2 rounded text-xs transition-colors',
                isOpen
                  ? 'bg-surface-hover text-primary'
                  : 'text-secondary hover:bg-surface-hover hover:text-primary',
              )}
            >
              {menu.label}
            </button>
            {isOpen && (
              <MenuDropdown
                items={menu.items}
                onItemClick={(item) => {
                  item.action?.();
                  close();
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

interface MenuDropdownProps {
  items: MenuItem[];
  onItemClick: (item: MenuItem) => void;
}

const MenuDropdown = ({ items, onItemClick }: MenuDropdownProps) => (
  <div className="absolute top-full left-0 mt-0.5 min-w-[200px] bg-elevated border border-default rounded-md shadow-xl py-1 animate-fade-in">
    {items.map((item, idx) =>
      item.separator ? (
        <div
          key={`sep-${idx}`}
          className="h-px bg-default my-1 mx-1"
          aria-hidden
        />
      ) : (
        <DropdownItem
          key={`item-${idx}-${item.label}`}
          item={item}
          onClick={() => !item.disabled && onItemClick(item)}
        />
      ),
    )}
  </div>
);

const DropdownItem = ({
  item,
  onClick,
}: {
  item: MenuItem;
  onClick: () => void;
}): ReactNode => (
  <button
    onClick={onClick}
    disabled={item.disabled}
    className={clsx(
      'w-full flex items-center gap-4 px-3 py-1 text-xs text-left transition-colors',
      item.disabled
        ? 'text-disabled cursor-default'
        : 'text-secondary hover:bg-surface-hover hover:text-primary',
    )}
  >
    <span className="flex-1 truncate">{item.label}</span>
    {item.shortcut && (
      <span className="text-[10px] text-muted font-mono shrink-0">
        {item.shortcut}
      </span>
    )}
  </button>
);
