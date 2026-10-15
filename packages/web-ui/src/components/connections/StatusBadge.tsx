import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Chip } from '../ui/Chip';

export interface StatusBadgeProps {
  isActive: boolean;
  isOpen: boolean;
  isConnecting: boolean;
}

/** Live connection state as a `success` pill: pulsing dot when active, steady when merely open. */
export const StatusBadge = ({ isActive, isOpen, isConnecting }: StatusBadgeProps) => {
  const { t } = useTranslation();
  if (isConnecting) return <Loader2 size={13} className="animate-spin text-accent" />;
  if (isActive) return (
    <Chip tone="success" shape="pill" dot="pulse">{t('connections.active')}</Chip>
  );
  if (isOpen) return (
    <Chip tone="success" shape="pill" dot="static" className="opacity-80">{t('connections.open')}</Chip>
  );
  return null;
};
