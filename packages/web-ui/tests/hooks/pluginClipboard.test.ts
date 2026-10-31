import {describe, it, expect, vi} from 'vitest';
import {copyText} from '@/hooks/usePluginApi';

const {writeClipboard} = vi.hoisted(() => ({writeClipboard: vi.fn()}));
vi.mock('@/platform/activeCapabilities', () => ({
    getActivePlatformCapabilities: () => ({writeClipboard}),
}));

describe('plugin clipboard', () => {
    it('uses the active host clipboard and propagates permission failures', async () => {
        writeClipboard.mockResolvedValue(undefined);
        await copyText('npm install -g neon@latest');
        expect(writeClipboard).toHaveBeenCalledWith('npm install -g neon@latest');
        writeClipboard.mockRejectedValue(new Error('Clipboard denied'));
        await expect(copyText('command')).rejects.toThrow('Clipboard denied');
    });
});
