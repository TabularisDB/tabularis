import {readFileSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

type Messages = {[key: string]: string | Messages};

const localesDirectory = resolve(__dirname, '../../src/i18n/locales');
const localeFiles = readdirSync(localesDirectory)
    .filter((file) => file.endsWith('.json'))
    .sort();

function paramMessages(file: string): Messages {
    const locale = JSON.parse(readFileSync(resolve(localesDirectory, file), 'utf8')) as {
        editor: {notebook: {params: Messages}};
    };
    return locale.editor.notebook.params;
}

/** `types.raw`-style paths of every string under `messages`. */
function flatten(messages: Messages, prefix = ''): Record<string, string> {
    return Object.entries(messages).reduce<Record<string, string>>((all, [key, value]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        return typeof value === 'string'
            ? {...all, [path]: value}
            : {...all, ...flatten(value, path)};
    }, {});
}

const placeholders = (text: string) => [...text.matchAll(/\{\{\w+\}\}/g)].map((m) => m[0]).sort();

const english = flatten(paramMessages('en.json'));
// Sentences: a translation that still reads as the English one was not translated.
const sentences = [
    'rawHint',
    'unsupportedDriver',
    'errors.invalid',
    'errors.quoted',
    'errors.unsupported',
];

describe('notebook parameter translations', () => {
    it('defines the keys the panel and the cell errors use', () => {
        expect(Object.keys(english).sort()).toEqual(
            [
                'apply',
                'discard',
                'errors.invalid',
                'errors.quoted',
                'errors.unsupported',
                'issues.cellReference',
                'issues.emptyNeedsNull',
                'issues.invalidBoolean',
                'issues.invalidDate',
                'issues.invalidNumber',
                'issues.invalidOption',
                'issues.noOptions',
                'issues.required',
                'null',
                'options',
                'rawHint',
                'remove',
                'required',
                'type',
                'types.boolean',
                'types.date',
                'types.number',
                'types.raw',
                'types.select',
                'types.text',
                'unapplied',
                'unsupportedDriver',
                'value',
            ].sort(),
        );
    });

    describe.each(localeFiles)('%s', (file) => {
        const messages = flatten(paramMessages(file));

        it('defines every key with a non-empty string', () => {
            expect(Object.keys(messages).sort()).toEqual(Object.keys(english).sort());
            for (const value of Object.values(messages)) expect(value.trim()).not.toBe('');
        });

        it('keeps the placeholders of the English text', () => {
            for (const [key, value] of Object.entries(messages)) {
                expect(placeholders(value), key).toEqual(placeholders(english[key]));
            }
        });
    });

    it.each(localeFiles.filter((file) => file !== 'en.json'))(
        '%s translates the sentences',
        (file) => {
            const messages = flatten(paramMessages(file));
            for (const key of sentences) expect(messages[key], key).not.toBe(english[key]);
        },
    );
});
