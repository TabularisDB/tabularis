import {describe, expect, it} from 'vitest';
import manifestSchema from '../../../../plugins/manifest.schema.json';
import extensionsSchema from '../../../../plugins/tabularium-extensions.schema.json';

describe('query classification manifest contract', () => {
    for (const [name, schema] of Object.entries({manifestSchema, extensionsSchema})) {
        it(`declares query_classification as an optional, default-false capability in ${name}`, () => {
            const capabilities = schema.properties.capabilities;
            expect(capabilities.properties.query_classification).toMatchObject({
                type: 'boolean',
                default: false,
            });
            if ('required' in capabilities) {
                expect(capabilities.required).not.toContain('query_classification');
            }
        });
    }
});
