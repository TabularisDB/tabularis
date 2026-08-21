import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

export interface StatusBadgeProps {
  isActive: boolean;
  isOpen: boolean;
  isConnecting: boolean;
}

export const StatusBadge = ({ isActive, isOpen, isConnecting }: StatusBadgeProps) => {
  const { t } = useTranslation();
  if (isConnecting) return <Loader2 size={13} className="animate-spin text-blue-400" />;
  if (isActive) return (
    <span className="flex items-center gap-1 text-[10px] font-bold text-green-400 bg-green-400/12 border border-green-400/25 px-1.5 py-0.5 rounded-full whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
      {t('connections.active')}
    </span>
  );
  if (isOpen) return (
    <span className="flex items-center gap-1 text-[10px] font-semibold text-green-400/80 bg-green-400/8 border border-green-400/20 px-1.5 py-0.5 rounded-full whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-green-400/70" />
      {t('connections.open')}
    </span>
  );
  return null;
};
