import {describe, it, expect, beforeAll} from 'vitest';
import i18n from 'i18next';
import en from '@/i18n/locales/en.json';
import de from '@/i18n/locales/de.json';
import {toErrorMessage, splitErrorDetails, isManagedConnectionDenied} from '@/utils/errors';
import {TabularisClientError} from '@/api/errors';

describe('toErrorMessage', () => {
    it('returns strings unchanged', () => {
        expect(toErrorMessage('boom')).toBe('boom');
    });

    it('extracts the message from Error instances', () => {
        expect(toErrorMessage(new Error('kaboom'))).toBe('kaboom');
    });

    it('reads the message field of plain objects', () => {
        expect(toErrorMessage({message: 'from object'})).toBe('from object');
    });

    it('falls back to String() for arbitrary values', () => {
        expect(toErrorMessage(42)).toBe('42');
        expect(toErrorMessage(null)).toBe('null');
    });
});

describe('splitErrorDetails', () => {
    it('splits summary and technical detail on the Error marker', () => {
        const msg =
            'Failed to connect to Dev.\n\nError: ssh: connect to host x port 22: Connection refused';
        expect(splitErrorDetails(msg)).toEqual({
            summary: 'Failed to connect to Dev.',
            details: 'ssh: connect to host x port 22: Connection refused',
        });
    });

    it('treats the whole message as summary when no marker is present', () => {
        expect(splitErrorDetails('Something went wrong')).toEqual({
            summary: 'Something went wrong',
            details: null,
        });
    });

    it('returns null details when the detail part is blank', () => {
        expect(splitErrorDetails('Header\n\nError:   ')).toEqual({
            summary: 'Header',
            details: null,
        });
    });

    it('preserves multi-line technical detail', () => {
        const detail = 'line 1\nline 2\nline 3';
        const {summary, details} = splitErrorDetails(`Headline\n\nError: ${detail}`);
        expect(summary).toBe('Headline');
        expect(details).toBe(detail);
    });
});

describe('managed connection denials', () => {
    beforeAll(async () => {
        await i18n.init({
            lng: 'en',
            fallbackLng: 'en',
            resources: {en: {translation: en}, de: {translation: de}},
        });
    });

    const denial = (message: string) =>
        new TabularisClientError({
            code: 'managed_connection_denied',
            message,
            details: {action: 'delete'},
            requestId: 'request-1',
        });

    it('recognises the denial by its code, not its text', () => {
        expect(isManagedConnectionDenied(denial('anything at all'))).toBe(true);
        expect(isManagedConnectionDenied({code: 'managed_connection_denied'})).toBe(true);
        expect(isManagedConnectionDenied(new Error('managed_connection_denied'))).toBe(false);
        expect(
            isManagedConnectionDenied(
                new TabularisClientError({
                    code: 'FORBIDDEN',
                    message: 'This connection is managed by an administrator',
                    details: null,
                    requestId: 'r',
                }),
            ),
        ).toBe(false);
        expect(isManagedConnectionDenied(null)).toBe(false);
        expect(isManagedConnectionDenied('managed_connection_denied')).toBe(false);
    });

    it('shows the translated message instead of the server text', async () => {
        const error = denial('server wording that must not be shown');

        expect(toErrorMessage(error)).toBe(en.managed.denied);
        await i18n.changeLanguage('de');
        expect(toErrorMessage(error)).toBe(de.managed.denied);
        expect(toErrorMessage(error)).not.toContain('server wording');
        await i18n.changeLanguage('en');
    });

    it('leaves every other error untouched', () => {
        expect(toErrorMessage(new Error('boom'))).toBe('boom');
    });
});
