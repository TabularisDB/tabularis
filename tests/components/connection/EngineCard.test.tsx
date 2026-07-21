import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EngineCard } from '../../../src/components/modals/connection/EngineCard';
import type { EngineGroup } from '../../../src/utils/connectionCatalogue';

const group: EngineGroup = {
  engine: 'firestore',
  displayName: 'Firestore',
  primaryParadigm: 'document',
  secondaryParadigms: ['vector'],
  drivers: [
    { slug: 'fs-a', name: 'Firestore', engine: 'firestore', paradigms: ['document', 'vector'], verified: true, installed: false, installedVersion: null, latestVersion: '1.0.0', isBuiltin: false, platformSupported: true, downloads: 1200, updateAvailable: false, icon: null, color: null },
    { slug: 'fs-b', name: 'FS Alt', engine: 'firestore', paradigms: ['document'], verified: false, installed: true, installedVersion: '0.9.0', latestVersion: '0.9.0', isBuiltin: false, platformSupported: true, downloads: 30, updateAvailable: false, icon: null, color: null },
  ],
  installed: true,
  verified: true,
  platformSupported: true,
  downloads: 1230,
};

describe('EngineCard', () => {
  it('renders name, verified badge, installed badge, multi-driver count', () => {
    render(<EngineCard group={group} onSelect={vi.fn()} />);
    expect(screen.getByText('Firestore')).toBeInTheDocument();
    // i18n is mocked to echo the key, so assert on keys (count interpolation is
    // resolved by real i18next at runtime, not by the test mock).
    expect(screen.getByText(/connectionCatalogue\.verified/i)).toBeInTheDocument();
    expect(screen.getByText(/connectionCatalogue\.installed/i)).toBeInTheDocument();
    expect(screen.getByText(/connectionCatalogue\.driverCount/i)).toBeInTheDocument();
  });

  it('marks a group with no platform build as unavailable', () => {
    render(<EngineCard group={{ ...group, installed: false, platformSupported: false }} onSelect={vi.fn()} />);
    expect(screen.getByText(/connectionCatalogue\.unavailableOnPlatform/i)).toBeInTheDocument();
    expect(screen.queryByText(/connectionCatalogue\.install$/i)).not.toBeInTheDocument();
  });

  it('calls onSelect with the group when clicked', () => {
    const onSelect = vi.fn();
    render(<EngineCard group={group} onSelect={onSelect} />);
    screen.getByRole('button').click();
    expect(onSelect).toHaveBeenCalledWith(group);
  });
});
