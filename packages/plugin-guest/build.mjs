import {createRequire} from 'node:module';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireFromRoot = createRequire(path.join(root, 'package.json'));
let esbuild;
try {
    esbuild = requireFromRoot('esbuild');
} catch {
    // pnpm may have esbuild available through Vite without a root-level link.
    const requireFromVite = createRequire(requireFromRoot.resolve('vite'));
    esbuild = requireFromVite('esbuild');
}
const output = path.join(root, 'src-tauri/resources/guest/runtime.js');
mkdirSync(path.dirname(output), {recursive: true});

await esbuild.build({
    entryPoints: [path.join(root, 'packages/plugin-guest/src/runtime.ts')],
    outfile: output,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    alias: {'@': path.join(root, 'packages/web-ui/src')},
    jsx: 'automatic',
    define: {'process.env.NODE_ENV': '"production"'},
});

// Shared guest components use the same generated utilities and theme tokens as the app.
const postcss = requireFromRoot('postcss');
const cssPath = path.join(root, 'packages/web-ui/src/index.css');
const styles = postcss.parse(readFileSync(cssPath, 'utf8'), {from: cssPath});
// Fonts remain host-owned; the opaque guest must not fetch app assets or remote URLs.
styles.walkAtRules('font-face', (rule) => rule.remove());
const css = await postcss([
    requireFromRoot('@tailwindcss/postcss')({base: path.join(root, 'packages/web-ui')}),
    requireFromRoot('autoprefixer')(),
]).process(styles, {from: cssPath, map: false});
writeFileSync(
    path.join(path.dirname(output), 'host.css'),
    `${css.css}\n${readFileSync(path.join(root, 'packages/plugin-guest/src/host.css'), 'utf8')}`,
);
