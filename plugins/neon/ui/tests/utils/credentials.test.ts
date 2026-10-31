import {describe, expect, it} from 'vitest';
import {CredentialParseError, parseCredentials} from '../../src/utils/credentials';

describe('parseCredentials', () => {
    it('accepts dotenv exports, CRLF, quotes, comments and equals signs in values', () => {
        expect(
            parseCredentials(
                '# comment\r\nexport DATABASE_URL="postgres://user:pass@host/db?x=a=b" # note\r\nNEON_BRANCH=dev # note',
            ),
        ).toEqual({DATABASE_URL: 'postgres://user:pass@host/db?x=a=b', NEON_BRANCH: 'dev'});
    });
    it('preserves hash characters within quoted credentials', () => {
        expect(parseCredentials("NEON_API_KEY='secret#part'\nNEON_BRANCH=branch#1")).toEqual({
            NEON_API_KEY: 'secret#part',
            NEON_BRANCH: 'branch#1',
        });
    });
    it('accepts a JSON credential object', () => {
        expect(parseCredentials('{"NEON_BRANCH":"dev"}')).toEqual({NEON_BRANCH: 'dev'});
    });
    it.each([
        '',
        '# comment',
        '{}',
        'NEON_BRANCH="',
        'NOT_A_FIELD=secret',
        'NEON_BRANCH=',
        '{"NEON_BRANCH":42}',
        'NEON_BRANCH=one\nNEON_BRANCH=two',
        'NEON_BRANCH="one" trailing',
        '{"__proto__":"secret"}',
        'bad-secret-data',
    ])('rejects invalid credentials without reflecting the source: %s', (input) => {
        try {
            parseCredentials(input);
            throw new Error('Expected rejection');
        } catch (error) {
            expect(error).toBeInstanceOf(CredentialParseError);
            expect(String(error)).not.toContain('secret');
        }
    });
});

it('accepts the complete standard Neon pull fields and function URLs', () => {
    const input =
        'DATABASE_URL_UNPOOLED=postgres://direct.example/db\nNEON_AUTH_JWKS_URL=https://auth.example/jwks\nNEON_FUNCTION_DEMOSUMMARY_BASE_URL=https://function.example';
    expect(parseCredentials(input)).toEqual({
        DATABASE_URL_UNPOOLED: 'postgres://direct.example/db',
        NEON_AUTH_JWKS_URL: 'https://auth.example/jwks',
        NEON_FUNCTION_DEMOSUMMARY_BASE_URL: 'https://function.example',
    });
});
