import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import {CredentialProfileConnectionFields} from '@/components/modals/CredentialProfileConnectionFields';

const profiles = [
    {id: 'profile-1', name: 'Shared login', username: 'profile_user'},
    {id: 'profile-2', name: 'Other login', username: 'other_user'},
];

vi.mock('@/components/ui/Select', () => ({
    Select: ({
        ariaLabel,
        value,
        options,
        onChange,
        labels,
    }: {
        ariaLabel?: string;
        value: string;
        options: string[];
        onChange: (value: string) => void;
        labels?: Record<string, string>;
    }) => (
        <select
            aria-label={ariaLabel}
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value)}
        >
            {options.map((option) => (
                <option key={option} value={option}>
                    {labels?.[option] ?? option}
                </option>
            ))}
        </select>
    ),
}));

vi.mock('@/hooks/useTabularisClient', () => ({
    useTabularisClient: () => ({
        call: vi.fn(),
    }),
}));

describe('CredentialProfileConnectionFields save-as lifecycle', () => {
    const onCredentialProfileChange = vi.fn();
    const onPendingSaveAsProfileNameChange = vi.fn();
    const onManageProfiles = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    function renderFields(
        overrides: Partial<Parameters<typeof CredentialProfileConnectionFields>[0]> = {},
    ) {
        return render(
            <CredentialProfileConnectionFields
                profiles={profiles}
                credentialProfileId={undefined}
                username="inline_user"
                password="inline-secret"
                useIamAuth={false}
                onCredentialProfileChange={onCredentialProfileChange}
                onManageProfiles={onManageProfiles}
                pendingSaveAsProfileName={undefined}
                onPendingSaveAsProfileNameChange={onPendingSaveAsProfileNameChange}
                {...overrides}
            />,
        );
    }

    it('queues save-as profile creation without linking until connection save', () => {
        renderFields();
        fireEvent.click(screen.getByText('newConnection.saveAsCredentialProfile'));
        fireEvent.change(screen.getByPlaceholderText('credentialProfiles.namePlaceholder'), {
            target: {value: 'Queued profile'},
        });
        fireEvent.click(screen.getByText('newConnection.saveAsCredentialProfileConfirm'));

        expect(onPendingSaveAsProfileNameChange).toHaveBeenCalledWith('Queued profile');
        expect(onCredentialProfileChange).not.toHaveBeenCalled();
    });

    it('does not call the API when the save-as panel is cancelled', () => {
        renderFields();
        fireEvent.click(screen.getByText('newConnection.saveAsCredentialProfile'));
        fireEvent.click(
            screen.getByRole('button', {name: 'newConnection.saveAsCredentialProfileCancel'}),
        );
        expect(onPendingSaveAsProfileNameChange).not.toHaveBeenCalled();
    });

    it('renders safely when profiles are temporarily unavailable', () => {
        renderFields({profiles: undefined as unknown as typeof profiles});
        expect(
            screen.getByRole('combobox', {name: 'newConnection.selectCredentialProfile'}),
        ).toBeInTheDocument();
    });

    it('clears pending save-as when selecting an existing profile', () => {
        renderFields({pendingSaveAsProfileName: 'Queued profile'});
        fireEvent.change(
            screen.getByRole('combobox', {name: 'newConnection.selectCredentialProfile'}),
            {
                target: {value: 'profile-1'},
            },
        );
        expect(onPendingSaveAsProfileNameChange).toHaveBeenCalledWith(undefined);
        expect(onCredentialProfileChange).toHaveBeenCalled();
    });
});
