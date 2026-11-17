import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {ConnectionCapabilitiesProvider} from '@/contexts/ConnectionCapabilitiesProvider';
import {useConnectionCapabilities} from '@/hooks/useConnectionCapabilities';
import {STANDALONE_CONNECTION_CAPABILITIES, type SessionNegotiation} from '@/api/session';

function Probe() {
    const {managed, canCreate, canEditOrganization} = useConnectionCapabilities();
    return (
        <p>
            {String(managed)}/{String(canCreate)}/{String(canEditOrganization)}
        </p>
    );
}

describe('ConnectionCapabilitiesProvider', () => {
    it('is unrestricted without a provider', () => {
        render(<Probe />);

        expect(screen.getByText('false/true/true')).toBeInTheDocument();
    });

    it('is unrestricted on the desktop, which has no session', () => {
        render(
            <ConnectionCapabilitiesProvider session={null}>
                <Probe />
            </ConnectionCapabilitiesProvider>,
        );

        expect(screen.getByText('false/true/true')).toBeInTheDocument();
    });

    it('provides the capabilities the server negotiated', () => {
        const session = {
            connections: {
                ...STANDALONE_CONNECTION_CAPABILITIES,
                managed: true,
                canCreate: false,
                canEditOrganization: false,
            },
        } as SessionNegotiation;

        render(
            <ConnectionCapabilitiesProvider session={session}>
                <Probe />
            </ConnectionCapabilitiesProvider>,
        );

        expect(screen.getByText('true/false/false')).toBeInTheDocument();
    });
});
