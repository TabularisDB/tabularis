import { cp, readFile, writeFile, mkdir, mkdtemp, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, '.tabularium'), 'utf8'));
const temp = await mkdtemp(join(tmpdir(), 'tabularis-neon-package-'));
const pendingArchive = `${temp}.zip`;
try {
  for (const file of ['dist', 'locales', '.tabularium', 'node_modules', 'README.md', 'LICENSE', 'assets']) await cp(join(root, file), join(temp, file), { recursive: true, verbatimSymlinks: true });
  await mkdir(join(temp, 'ui'), { recursive: true });
  await cp(join(root, 'ui/dist'), join(temp, 'ui/dist'), { recursive: true });
  await writeFile(join(temp, 'package.json'), JSON.stringify({ type: 'module' }) + '\n');
  const archive = join(root, `neon-${manifest.version}-${process.platform}-${process.arch}.zip`);
  // Dereference pnpm's relative dependency links so the archive is self-contained.
  const result = spawnSync('zip', ['-qr', pendingArchive, '.'], { cwd: temp, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('ZIP creation failed; install zip and retry');
  await rename(pendingArchive, archive);
  console.log(`Plugin archive created: ${archive} (Node.js 22+ required on destination)`);
} finally {
  await rm(temp, { recursive: true, force: true });
  await rm(pendingArchive, { force: true });
}
