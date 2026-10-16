import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Stage the dedicated NSIS build under a name distinct from direct downloads. */
export function stageWingetInstaller(tag, root = process.cwd()) {
  if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error('Expected a stable release tag, for example v0.27.0');
  }
  const version = tag.slice(1);
  const source = join(root, 'src-tauri/target/release/bundle/nsis', `tabularis_${version}_x64-setup.exe`);
  const asset = `tabularis_${version}_winget_x64-setup.exe`;
  copyFileSync(source, join(root, asset));
  return asset;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tag = process.argv[2];
  const asset = stageWingetInstaller(tag);
  const result = spawnSync('gh', ['release', 'upload', tag, asset, '--clobber'], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
