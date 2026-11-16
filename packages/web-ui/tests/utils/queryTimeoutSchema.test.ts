import {describe, expect, it} from 'vitest';
import manifestSchema from '../../../../plugins/manifest.schema.json';
import extensionsSchema from '../../../../plugins/tabularium-extensions.schema.json';

describe('query timeout manifest contract', () => {
    for (const [name, schema] of Object.entries({manifestSchema, extensionsSchema})) {
        it(`declares an optional, default-false capability in ${name}`, () => {
            const capabilities = schema.properties.capabilities;
            expect(capabilities.properties.query_timeout).toMatchObject({
                type: 'boolean',
                default: false,
            });
            if ('required' in capabilities) {
                expect(capabilities.required).not.toContain('query_timeout');
            }
        });
    }
});
