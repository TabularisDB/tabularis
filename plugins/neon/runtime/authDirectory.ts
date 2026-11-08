import pg from 'pg';
import {env} from './env.js';
import type {Params} from './database.js';

export interface AuthUser {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    createdAt: string;
    role: string | null;
}
type Query = (query: string, values?: unknown[]) => Promise<{rows: Record<string, unknown>[]}>;

function integer(value: unknown, fallback: number, maximum: number): number {
    if (value === undefined) return fallback;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum)
        throw new Error('Invalid Auth pagination');
    return value;
}

function date(value: unknown): string {
    return value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : '';
}
function user(row: Record<string, unknown>): AuthUser {
    return {
        id: String(row.id),
        name: typeof row.name === 'string' ? row.name : '',
        email: typeof row.email === 'string' ? row.email : '',
        emailVerified: row.emailVerified === true,
        createdAt: date(row.createdAt),
        role: typeof row.role === 'string' ? row.role : null,
    };
}

/** Reads use the selected connection; admin mutations never write Better Auth's internal tables. */
export async function authDirectory(method: string, args: Params, query?: Query): Promise<unknown> {
    if (!['neon_auth_users_page', 'neon_auth_user_details'].includes(method))
        throw new Error('Unsupported Auth directory method');
    const offset = integer(args.offset, 0, 1000000);
    const limit = integer(args.limit, 50, 100);
    if (!limit) throw new Error('Auth page size must be at least one');
    if (args.search !== undefined && (typeof args.search !== 'string' || args.search.length > 200))
        throw new Error('Auth search must be at most 200 characters');
    const search = typeof args.search === 'string' ? args.search : '';
    const userId = args.userId;
    if (
        method === 'neon_auth_user_details' &&
        (typeof userId !== 'string' || !userId || userId.length > 128 || /[\0\r\n]/.test(userId))
    )
        throw new Error('Invalid Auth user ID');
    let client: pg.Client | undefined;
    if (!query) {
        client = new pg.Client({
            connectionString: env('DATABASE_URL'),
            ssl: {rejectUnauthorized: true},
            connectionTimeoutMillis: 15000,
            statement_timeout: 15000,
        });
        await client.connect();
        const connected = client;
        query = (sql, values) => connected.query(sql, values);
    }
    try {
        const columns = await query(
            'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
            ['neon_auth', 'user'],
        );
        const names = new Set(columns.rows.map((row) => row.column_name));
        if (!names.has('id') || !names.has('email'))
            throw new Error('Auth directory is unavailable in this database');
        const select = `id, name, email, "emailVerified", "createdAt", ${names.has('role') ? 'role' : 'NULL::text AS role'}`;
        if (method === 'neon_auth_users_page') {
            const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
            const [rows, count] = await Promise.all([
                query(
                    `SELECT ${select} FROM neon_auth."user" WHERE email ILIKE $1 OR name ILIKE $1 ORDER BY "createdAt" DESC, id LIMIT $2 OFFSET $3`,
                    [pattern, limit, offset],
                ),
                query(
                    'SELECT count(*)::int AS total FROM neon_auth."user" WHERE email ILIKE $1 OR name ILIKE $1',
                    [pattern],
                ),
            ]);
            return {users: rows.rows.map(user), total: Number(count.rows[0]?.total ?? 0)};
        }
        const rows = await query(`SELECT ${select} FROM neon_auth."user" WHERE id = $1`, [userId]);
        if (!rows.rows[0]) throw new Error('Auth user was not found');
        const sessionColumns = await query(
            'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
            ['neon_auth', 'session'],
        );
        const sessionNames = new Set(sessionColumns.rows.map((row) => row.column_name));
        const sessions = ['id', 'userId', 'createdAt', 'expiresAt'].every((name) =>
            sessionNames.has(name),
        )
            ? await query(
                  'SELECT id, "createdAt", "expiresAt" FROM neon_auth.session WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 100',
                  [userId],
              )
            : {rows: []};
        return {
            user: user(rows.rows[0]),
            sessions: sessions.rows.map((row) => ({
                id: String(row.id),
                createdAt: date(row.createdAt),
                expiresAt: date(row.expiresAt),
            })),
            capabilities: {profileUpdate: false, sessionRevoke: false, passwordReset: false},
        };
    } finally {
        await client?.end();
    }
}
