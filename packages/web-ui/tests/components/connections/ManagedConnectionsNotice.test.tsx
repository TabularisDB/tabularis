import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {ManagedConnectionsNotice} from '@/components/connections/ManagedConnectionsNotice';

describe('ManagedConnectionsNotice', () => {
    it('explains that an administrator manages the connections', () => {
        render(<ManagedConnectionsNotice />);

        expect(screen.getByRole('note')).toBeInTheDocument();
        expect(screen.getByText('managed.noticeTitle')).toBeInTheDocument();
        expect(screen.getByText('managed.notice')).toBeInTheDocument();
    });
});
