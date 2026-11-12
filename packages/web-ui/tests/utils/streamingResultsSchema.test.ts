import {describe, expect, it} from 'vitest';
import manifestSchema from '../../../../plugins/manifest.schema.json';
import type {DriverCapabilities} from '@/types/plugins';

describe('streaming results manifest contract', () => {
    it('declares an optional, default-false capability in the manifest schema', () => {
        const capabilities = manifestSchema.properties.capabilities;
        expect(capabilities.properties.streaming_results).toMatchObject({
            type: 'boolean',
            default: false,
        });
        expect(capabilities.required).not.toContain('streaming_results');
    });

    it('includes the capability in the plugin types', () => {
        const capabilities: Pick<DriverCapabilities, 'streaming_results'> = {
            streaming_results: true,
        };
        expect(capabilities.streaming_results).toBe(true);
    });
});
