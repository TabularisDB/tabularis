import {
    mkdir,
    lstat,
    realpath,
    cp,
    readFile,
    writeFile,
    rm,
    rename,
    mkdtemp,
    unlink,
} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const source = fileURLToPath(new URL('../', import.meta.url));
const data =
    process.platform === 'win32'
        ? (process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'))
        : process.platform === 'darwin'
          ? join(homedir(), 'Library', 'Application Support')
          : (process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'));
const parent = join(data, 'tabularis', 'plugins', 'drivers');
const target = join(parent, 'neon');
await mkdir(parent, {recursive: true});
const marker = '.development-source';
try {
    const info = await lstat(target);
    const owned = info.isSymbolicLink()
        ? (await realpath(target)) === (await realpath(source))
        : (await readFile(join(target, marker), 'utf8')).trim() === source;
    if (!owned) throw new Error(`Refusing to overwrite another installation: ${target}`);
} catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // A directory without our marker belongs to another installation.
    try {
        await lstat(target);
        throw new Error(`Refusing to overwrite unmarked plugin: ${target}`);
    } catch (probe) {
        if (probe.code !== 'ENOENT') throw probe;
    }
}
const stage = await mkdtemp(join(parent, '.tmp-neon-'));
try {
    // Explicit whitelist: never copy .env, .neon, test credentials or the development checkout.
    for (const file of ['dist', 'locales', '.tabularium', 'node_modules']) {
        await cp(join(source, file), join(stage, file), {recursive: true, verbatimSymlinks: true});
    }
    await mkdir(join(stage, 'ui'), {recursive: true});
    await cp(join(source, 'ui', 'dist'), join(stage, 'ui', 'dist'), {recursive: true});
    await writeFile(join(stage, 'package.json'), JSON.stringify({type: 'module'}) + '\n');
    await writeFile(join(stage, marker), source + '\n');
    const previous = await mkdtemp(join(parent, '.previous-neon-'));
    await rm(previous, {recursive: true, force: true});
    let moved = false;
    try {
        await rename(target, previous);
        moved = true;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    try {
        await rename(stage, target);
    } catch (error) {
        if (moved) await rename(previous, target);
        throw error;
    }
    await rm(previous, {recursive: true, force: true});
    // Remove only the old development symlink owned by this checkout.
    const legacy = join(data, 'tabularis', 'plugins', 'neon');
    try {
        if (
            (await lstat(legacy)).isSymbolicLink() &&
            (await realpath(legacy)) === (await realpath(source))
        )
            await unlink(legacy);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    console.log(
        `Installed Neon development plugin: ${target}. Restart Tabularis to load the new bundle.`,
    );
} finally {
    await rm(stage, {recursive: true, force: true});
}
