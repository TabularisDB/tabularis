import path from 'node:path';
import {defineConfig, type Options} from 'tsup';

type EsbuildPlugin = NonNullable<Options['esbuildPlugins']>[number];

// Theme helpers are shared with the app (packages/web-ui/src/), which imports through '@/'.
// esbuild's `alias` option rejects a bare '@', so resolve it with a plugin.
const appSrc = path.resolve(__dirname, '../web-ui/src');
const appAlias: EsbuildPlugin = {
    name: 'app-src-alias',
    setup(build) {
        build.onResolve({filter: /^@\//}, (args) =>
            build.resolve(`./${args.path.slice(2)}`, {resolveDir: appSrc, kind: args.kind}),
        );
    },
};

export default defineConfig({
    entry: {cli: 'src/cli.ts', theme: 'src/theme-cli.ts'},
    noExternal: ['ajv', 'semver', 'jsonc-parser'],
    esbuildPlugins: [appAlias],
    format: ['esm'],
    target: 'node18',
    platform: 'node',
    dts: false,
    sourcemap: false,
    clean: true,
    minify: false,
    splitting: false,
    shims: false,
    banner: {
        js: "#!/usr/bin/env node\nimport { createRequire as __themeCreateRequire } from 'node:module';\nconst require = __themeCreateRequire(import.meta.url);",
    },
});
