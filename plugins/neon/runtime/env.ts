import {AsyncLocalStorage} from 'node:async_hooks';
import {config} from 'dotenv';
import {fileURLToPath} from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
config({path: `${root}.env.local`, quiet: true});
config({path: `${root}.env`, quiet: true});

const credentials = new AsyncLocalStorage<Record<string, string>>();

export function withCredentials<T>(values: Record<string, string>, action: () => T): T {
    return credentials.run(values, action);
}

export function optionalEnv(name: string): string | undefined {
    const bound = credentials.getStore();
    return bound ? bound[name] : process.env[name];
}

export function env(name: string): string {
    const value = optionalEnv(name);
    if (!value) throw new Error(`Missing ${name}; run neon deploy in the plugin directory`);
    return value;
}
