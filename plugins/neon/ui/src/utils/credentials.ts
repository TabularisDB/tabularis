export const credentialNames = [
    'DATABASE_URL',
    'DATABASE_URL_UNPOOLED',
    'NEON_AUTH_JWKS_URL',
    'NEON_BRANCH',
    'NEON_BRANCH_ID',
    'NEON_PROJECT_ID',
    'NEON_API_KEY',
    'NEON_AUTH_BASE_URL',
    'AWS_ENDPOINT_URL_S3',
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'NEON_AI_GATEWAY_BASE_URL',
    'NEON_AI_GATEWAY_TOKEN',
    'NEON_FUNCTION_HELLO_BASE_URL',
    'NEON_REALTIME_URL',
    'NEON_REALTIME_SECRET',
] as const;

export type CredentialError = 'empty' | 'syntax' | 'unsupported' | 'value' | 'duplicate';

export class CredentialParseError extends Error {
    constructor(public readonly code: CredentialError) {
        super(code);
    }
}

/** Error messages deliberately exclude pasted input, which may contain secrets. */
export function parseCredentials(input: string): Record<string, string> {
    const source = input.trim();
    if (!source) throw new CredentialParseError('empty');
    const result: Record<string, string> = {};
    const put = (key: string, value: unknown) => {
        if (
            !(credentialNames as readonly string[]).includes(key) &&
            !/^NEON_FUNCTION_[A-Z0-9_]+_BASE_URL$/.test(key)
        )
            throw new CredentialParseError('unsupported');
        if (typeof value !== 'string' || !value.trim() || value.includes('\0'))
            throw new CredentialParseError('value');
        if (Object.hasOwn(result, key)) throw new CredentialParseError('duplicate');
        result[key] = value;
    };
    if (source.startsWith('{')) {
        let data: unknown;
        try {
            data = JSON.parse(source);
        } catch {
            throw new CredentialParseError('syntax');
        }
        if (!data || typeof data !== 'object' || Array.isArray(data))
            throw new CredentialParseError('syntax');
        for (const [key, value] of Object.entries(data)) put(key, value);
    } else {
        for (const line of source.split(/\r?\n/)) {
            if (!line.trim() || line.trim().startsWith('#')) continue;
            const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line.trim());
            if (!match) throw new CredentialParseError('syntax');
            let value = match[2];
            if (value.startsWith('"') || value.startsWith("'")) {
                const quote = value[0];
                const end = value.lastIndexOf(quote);
                if (end === 0 || !/^\s*(?:#.*)?$/.test(value.slice(end + 1)))
                    throw new CredentialParseError('syntax');
                value = value.slice(1, end);
            } else value = value.replace(/\s+#.*$/, '').trim();
            put(match[1], value);
        }
    }
    if (Object.keys(result).length === 0) throw new CredentialParseError('empty');
    return result;
}
