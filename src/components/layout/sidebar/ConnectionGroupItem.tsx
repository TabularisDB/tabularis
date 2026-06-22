import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, Unlink } from 'lucide-react';
import { useLingui } from '@lingui/react/macro';
import { useConnectionLayoutContext } from '../../../hooks/useConnectionLayoutContext';
import { ContextMenu } from '../../ui/ContextMenu';
import type { ConnectionStatus } from '../../../hooks/useConnectionManager';

interface Props {
  connections: ConnectionStatus[];
  mode: 'vertical' | 'horizontal';
}

export const ConnectionGroupItem = ({ connections, mode }: Props) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { deactivateSplit, showSplitView } = useConnectionLayoutContext();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const menuItems = [
    {
      label: t`Separate Connections`,
      icon: Unlink,
      action: deactivateSplit,
    },
  ];

  return (
    <>
      <div className="relative group w-full flex justify-center mb-1">
        <button
          onClick={() => { showSplitView(); navigate('/editor'); }}
          onContextMenu={handleContextMenu}
          className="flex items-center justify-center w-12 h-12 rounded-lg transition-all relative bg-purple-500/20 text-purple-400 ring-1 ring-purple-500/40"
          title={connections.map(c => c.name).join(' / ')}
        >
          <div className="relative flex items-center justify-center">
            <Database size={16} className="absolute -left-1 -top-1 opacity-70" />
            <Database size={16} className="absolute left-1 top-1" />
          </div>

          {/* Split mode badge */}
          <div className="absolute -bottom-0.5 -right-0.5 text-[8px] font-bold bg-purple-600 text-white rounded px-0.5 leading-tight">
            {mode === 'vertical' ? '⇔' : '⇕'}
          </div>
        </button>

        {/* Tooltip */}
        <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-surface-secondary text-primary text-xs px-2 py-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-30 pointer-events-none shadow-lg border border-default">
          <div className="font-medium">{t`Split Group`}</div>
          {connections.map(c => (
            <div key={c.id} className="text-muted text-[10px]">
              {c.name}
            </div>
          ))}
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
};
