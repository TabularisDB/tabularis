import {neon} from '@neondatabase/serverless';
import {readFile} from 'node:fs/promises';
const sql = neon(process.env.DATABASE_URL);
const migration = await readFile(
    new URL('../migrations/001_workspace.sql', import.meta.url),
    'utf8',
);
for (const statement of migration
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean))
    await sql.query(statement);
console.log('Applied additive tabularis_demo workspace schema.');
