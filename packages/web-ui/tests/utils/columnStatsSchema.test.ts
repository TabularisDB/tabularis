import {describe, expect, it} from 'vitest';
import manifestSchema from '../../../../plugins/manifest.schema.json';
import extensionsSchema from '../../../../plugins/tabularium-extensions.schema.json';

describe('column statistics manifest contract (#1137)', () => {
    for (const [name, schema] of Object.entries({manifestSchema, extensionsSchema})) {
        it(`declares an optional, default-false capability in ${name}`, () => {
            const capabilities = schema.properties.capabilities;
            expect(capabilities.properties.column_stats).toMatchObject({
                type: 'boolean',
                default: false,
            });
            if ('required' in capabilities) {
                expect(capabilities.required).not.toContain('column_stats');
            }
        });
    }
});
