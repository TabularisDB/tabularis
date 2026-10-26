import {describe, expect, it, vi} from 'vitest';
import {hydratePluginSlotContext, serializePluginSlotContext} from '@/plugins/sandbox/slotContext';

describe('sandbox slot callback bridge', () => {
    it('serializes callback-bearing contexts without sending functions', () => {
        const onDatabaseChange = vi.fn();
        const context = serializePluginSlotContext({
            driver: 'google-sheets',
            database: 'sheet-id',
            onDatabaseChange,
        });

        expect(context).toEqual({
            driver: 'google-sheets',
            database: 'sheet-id',
            __tabularisHostCallbacks: ['onDatabaseChange'],
        });
        expect(() => structuredClone(context)).not.toThrow();
    });

    it('hydrates only the callback shims declared by the host', () => {
        const callHost = vi.fn();
        const context = hydratePluginSlotContext(
            {
                driver: 'sqlserver',
                __tabularisHostCallbacks: ['setExtraField', 'setCredentialFieldsHidden'],
            },
            callHost,
        );

        expect(context.onDatabaseChange).toBeUndefined();
        (context.setExtraField as (key: string, value: string) => void)('region', 'west');
        (context.setCredentialFieldsHidden as (hidden: boolean) => void)(true);
        expect(callHost).toHaveBeenNthCalledWith(1, 'slot.setExtraField', 'region', 'west');
        expect(callHost).toHaveBeenNthCalledWith(2, 'slot.setCredentialFieldsHidden', true);
    });

    it('bridges secret-field callbacks while keeping secret values clone-safe', () => {
        const setSecretField = vi.fn();
        const context = serializePluginSlotContext({
            driver: 'bigquery',
            extra: {},
            secretFields: {
                service_account_json: {value: '', hasStoredValue: true, dirty: false},
            },
            setSecretField,
        });

        expect(context.__tabularisHostCallbacks).toEqual(['setSecretField']);
        expect(context.secretFields).toEqual({
            service_account_json: {value: '', hasStoredValue: true, dirty: false},
        });
        expect(() => structuredClone(context)).not.toThrow();

        const callHost = vi.fn();
        const hydrated = hydratePluginSlotContext(context, callHost);
        (hydrated.setSecretField as (key: string, value: string) => void)(
            'service_account_json',
            '{"type":"service_account"}',
        );
        expect(callHost).toHaveBeenCalledWith(
            'slot.setSecretField',
            'service_account_json',
            '{"type":"service_account"}',
        );
    });
});
