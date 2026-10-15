import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConnectionCatalogue } from '../../../src/components/modals/connection/ConnectionCatalogue';
import type { EngineGroup, ParadigmFacet } from '../../../src/utils/connectionCatalogue';

const mk = (engine: string, name: string, paradigm: string, verified = false): EngineGroup => ({
  engine, displayName: name, primaryParadigm: paradigm, secondaryParadigms: [],
  drivers: [{ slug: engine, name, engine, paradigms: [paradigm], verified, installed: false, installedVersion: null, latestVersion: '1', isBuiltin: false, platformSupported: true, downloads: 1, updateAvailable: false, icon: null, color: null }],
  installed: false, verified, platformSupported: true, downloads: 1,
});

const groups = [mk('postgres', 'PostgreSQL', 'sql', true), mk('qdrant', 'Qdrant', 'vector')];
const facets: ParadigmFacet[] = [{ key: 'sql', label: 'SQL', count: 1 }, { key: 'vector', label: 'Vector', count: 1 }];

describe('ConnectionCatalogue', () => {
  it('filters by search text', () => {
    render(<ConnectionCatalogue groups={groups} facets={facets} loading={false} registryOffline={false} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'qdr' } });
    expect(screen.queryByText('PostgreSQL')).not.toBeInTheDocument();
    expect(screen.getByText('Qdrant')).toBeInTheDocument();
  });

  it('filters by a paradigm chip', () => {
    render(<ConnectionCatalogue groups={groups} facets={facets} loading={false} registryOffline={false} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /SQL/i }));
    expect(screen.getByText('PostgreSQL')).toBeInTheDocument();
    expect(screen.queryByText('Qdrant')).not.toBeInTheDocument();
  });
});
