import {builtinModules} from 'node:module';
import {build, type BuildFailure} from 'esbuild';

export interface FunctionDiagnostic {
    message: string;
    line: number;
    column: number;
}
export interface CompiledFunction {
    valid: boolean;
    diagnostics: FunctionDiagnostic[];
    bundleBytes: number;
    code?: string;
}
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

/** Parse/bundle only: function source and imported modules are never executed locally. */
export async function compileFunction(
    source: unknown,
    language: unknown = 'javascript',
): Promise<CompiledFunction> {
    const invalid = (message: string): CompiledFunction => ({
        valid: false,
        diagnostics: [{message, line: 1, column: 1}],
        bundleBytes: 0,
    });
    if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > 262144)
        return invalid('Provide function source of at most 256 KiB');
    if (language !== 'javascript' && language !== 'typescript')
        return invalid('Choose JavaScript or TypeScript');
    try {
        const result = await build({
            stdin: {
                contents: source,
                sourcefile: language === 'typescript' ? 'index.ts' : 'index.js',
                loader: language === 'typescript' ? 'ts' : 'js',
            },
            bundle: true,
            write: false,
            metafile: true,
            platform: 'node',
            format: 'esm',
            target: 'node24',
            sourcemap: false,
            legalComments: 'none',
            logLevel: 'silent',
            plugins: [
                {
                    name: 'function-imports',
                    setup(builder) {
                        builder.onResolve({filter: /.*/}, (args) =>
                            builtins.has(args.path)
                                ? {path: args.path, external: true}
                                : {
                                      errors: [
                                          {
                                              text: 'This editor supports Node.js built-in imports. Bundle npm dependencies and additional files with the Neon CLI.',
                                          },
                                      ],
                                  },
                        );
                    },
                },
            ],
        });
        if (
            !Object.values(result.metafile!.outputs).some((output) =>
                output.exports.includes('default'),
            )
        )
            return invalid('Export a default request handler or an object with a fetch method');
        const code = result.outputFiles![0].text;
        return {valid: true, diagnostics: [], bundleBytes: Buffer.byteLength(code), code};
    } catch (error) {
        const errors = (error as BuildFailure).errors;
        return {
            valid: false,
            bundleBytes: 0,
            diagnostics: Array.isArray(errors)
                ? errors.slice(0, 20).map((error) => ({
                      message: error.text,
                      line: error.location?.line ?? 1,
                      column: (error.location?.column ?? 0) + 1,
                  }))
                : [{message: 'Function compilation failed', line: 1, column: 1}],
        };
    }
}
