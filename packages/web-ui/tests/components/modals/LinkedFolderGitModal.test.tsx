import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {LinkedFolderGitModal} from '@/components/modals/LinkedFolderGitModal';

const client = vi.hoisted(() => ({call: vi.fn()}));
const platform = vi.hoisted(() => ({supports: vi.fn()}));
const t = vi.hoisted(
    () => (key: string, options?: {path?: string}) =>
        options?.path ? `${key}:${options.path}` : key,
);
vi.mock('@/hooks/useTabularisClient', () => ({useTabularisClient: () => client}));
vi.mock('@/hooks/usePlatformCapabilities', () => ({usePlatformCapabilities: () => platform}));
vi.mock('react-i18next', () => ({useTranslation: () => ({t})}));
vi.mock('lucide-react', async () => await vi.importActual('lucide-react'));

const folder = {id: 'approved-root', name: 'Scripts', path: '/repo/scripts', available: true};
const review = {path: 'query.sql', diff: '-SELECT 1;\n+SELECT 2;', token: 'reviewed-version'};

describe('LinkedFolderGitModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        platform.supports.mockReturnValue(true);
        client.call.mockImplementation(async (command: string) => {
            if (command === 'linked_git_status')
                return {repository: '/repo', files: [{path: 'query.sql', status: ' M'}]};
            if (command === 'linked_git_review') return review;
            if (command === 'linked_git_commit') return {commit: 'abcdef123456', warning: null};
            throw new Error(command);
        });
    });

    it('requires a reviewed diff, explicit selection and message before committing', async () => {
        const user = userEvent.setup();
        render(<LinkedFolderGitModal folder={folder} onClose={vi.fn()} />);
        const include = await screen.findByRole('checkbox', {name: 'linkedGit.include:query.sql'});
        expect(include).toBeDisabled();
        expect(screen.getByRole('button', {name: 'linkedGit.commit'})).toBeDisabled();
        const reviewButton = screen.getByRole('button', {name: 'linkedGit.review:query.sql'});
        reviewButton.focus();
        await user.keyboard('{Enter}');
        await waitFor(() => expect(include).toBeEnabled());
        expect(screen.getByRole('textbox', {name: 'linkedGit.diff'})).toHaveValue(review.diff);
        expect(client.call).not.toHaveBeenCalledWith('linked_git_commit', expect.anything());
        await user.click(include);
        await user.type(screen.getByRole('textbox', {name: 'linkedGit.message'}), 'Review report');
        await user.click(screen.getByRole('button', {name: 'linkedGit.commit'}));
        await waitFor(() =>
            expect(client.call).toHaveBeenCalledWith('linked_git_commit', {
                id: folder.id,
                files: [{path: 'query.sql', token: review.token}],
                message: 'Review report',
            }),
        );
        expect(await screen.findByText('linkedGit.committed')).toBeInTheDocument();
    });

    it('clears prior reviews and selections on refresh', async () => {
        render(<LinkedFolderGitModal folder={folder} onClose={vi.fn()} />);
        fireEvent.click(await screen.findByRole('button', {name: 'linkedGit.review:query.sql'}));
        const include = screen.getByRole('checkbox', {name: 'linkedGit.include:query.sql'});
        await waitFor(() => expect(include).toBeEnabled());
        fireEvent.click(include);
        fireEvent.click(screen.getByRole('button', {name: 'linkedGit.refresh'}));
        await waitFor(() => expect(include).toBeDisabled());
        expect(include).not.toBeChecked();
    });

    it('reports stale-review failures without reporting success', async () => {
        render(<LinkedFolderGitModal folder={folder} onClose={vi.fn()} />);
        fireEvent.click(await screen.findByRole('button', {name: 'linkedGit.review:query.sql'}));
        const include = screen.getByRole('checkbox', {name: 'linkedGit.include:query.sql'});
        await waitFor(() => expect(include).toBeEnabled());
        fireEvent.click(include);
        fireEvent.change(screen.getByRole('textbox', {name: 'linkedGit.message'}), {
            target: {value: 'commit'},
        });
        client.call.mockRejectedValueOnce(new Error('Script changed since review'));
        fireEvent.click(screen.getByRole('button', {name: 'linkedGit.commit'}));
        expect(await screen.findByRole('alert')).toHaveTextContent('Script changed since review');
        expect(screen.queryByText('linkedGit.committed')).not.toBeInTheDocument();
    });

    it('does not invoke desktop Git commands in browser mode', () => {
        platform.supports.mockReturnValue(false);
        render(<LinkedFolderGitModal folder={folder} onClose={vi.fn()} />);
        expect(screen.getByText('linkedGit.desktopOnly')).toBeInTheDocument();
        expect(client.call).not.toHaveBeenCalled();
    });
});
