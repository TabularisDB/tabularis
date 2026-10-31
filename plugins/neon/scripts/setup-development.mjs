import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import '../dist/env.js';

if (process.platform !== 'linux') throw new Error('Use the Neon panel to import credentials on macOS/Windows; this development helper uses Linux secret-tool.');
const id = 'neon-prototype-production';
const url = new URL(process.env.DATABASE_URL);
const credentials = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(NEON_|AWS_|DATABASE_URL)/.test(key)));
credentials.NEON_PROJECT_ID = 'solitary-leaf-07190439';
const secretKey = `plugin:4:neon:${id.length}:${id}`;
for (const [username, value] of [[`${id}:db`, decodeURIComponent(url.password)], [secretKey, JSON.stringify(credentials)]]) {
  const result = spawnSync('secret-tool', ['store', '--label=Tabularis Neon development prototype', 'service', 'tabularis', 'username', username], { input: value, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Cannot write the OS keyring. Unlock it and retry, or configure credentials in the Neon panel.');
}
const dir = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'tabularis');
await mkdir(dir, { recursive: true });
const devPath = join(dir, 'connections.dev.json');
let connections;
try { connections = JSON.parse(await readFile(devPath, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  try { connections = JSON.parse(await readFile(join(dir, 'connections.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; connections = { groups: [], connections: [] }; }
}
const entry = { id, name: 'Neon Lab · production', params: { driver: 'neon', host: url.hostname, port: Number(url.port || 5432), username: decodeURIComponent(url.username), password: null, database: decodeURIComponent(url.pathname.slice(1)), ssl_mode: 'verify-full', save_in_keychain: true, connection_id: id } };
connections.connections = [...connections.connections.filter(item => item.id !== id), entry];
await writeFile(devPath, JSON.stringify(connections, null, 2) + '\n', { mode: 0o600 });
console.log(`Development connection created: ${entry.name}. Credentials stored in OS keyring; connection file: ${devPath}`);
