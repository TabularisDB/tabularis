import {describe, expect, it} from 'vitest';
import manifestSchema from '../../../../plugins/manifest.schema.json';
import extensionsSchema from '../../../../plugins/tabularium-extensions.schema.json';

describe('query classification manifest contract', () => {
    for (const [name, schema] of Object.entries({manifestSchema, extensionsSchema})) {
        for (const capability of ['query_classification', 'read_only_execution'] as const) {
            it(`declares ${capability} as an optional, default-false capability in ${name}`, () => {
                const capabilities = schema.properties.capabilities;
                expect(capabilities.properties[capability]).toMatchObject({
                    type: 'boolean',
                    default: false,
                });
                if ('required' in capabilities) {
                    expect(capabilities.required).not.toContain(capability);
                }
            });
        }
    }
});
