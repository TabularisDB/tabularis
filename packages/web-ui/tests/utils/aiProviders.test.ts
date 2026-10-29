import {describe, expect, it} from 'vitest';
import {mergeLocalAiProviders} from '@/utils/aiProviders';
import type {AiAssistantManifest} from '@/types/ai';

const provider: AiAssistantManifest = {
    id: 'fixture-ai',
    name: 'Fixture AI',
    version: '1.0.0',
    description: 'Local provider',
    kind: 'ai-assistant',
    settings: [],
    ai_assistant: {api_version: 1, authentication: 'none', default_models: []},
};

describe('mergeLocalAiProviders', () => {
    it('shows installed providers offline without treating them as drivers', () => {
        const merged = mergeLocalAiProviders([], [provider]);
        expect(merged).toMatchObject([
            {id: 'fixture-ai', kind: 'ai-assistant', installed_version: '1.0.0'},
        ]);
    });

    it('retains registry update metadata and keeps kind identities separate', () => {
        const local = mergeLocalAiProviders([], [provider])[0];
        const remote = {...local, latest_version: '2.0.0', update_available: true};
        expect(mergeLocalAiProviders([remote], [provider])).toEqual([remote]);
        expect(mergeLocalAiProviders([{...remote, kind: 'driver'}], [provider])).toHaveLength(2);
    });
});
