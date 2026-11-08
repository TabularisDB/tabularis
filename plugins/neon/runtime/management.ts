import {isNeonError, type NeonClient, type NeonFunction} from '@neon/sdk';
import {compileFunction} from './functionCompiler.js';
import {strToU8, zipSync} from 'fflate';
import type {Params} from './database.js';

export const managementMethods = new Set([
    'account_functions_list',
    'account_function_get',
    'account_function_deploy',
    'account_function_validate',
    'account_function_rename',
    'account_function_delete',
    'account_function_invoke',
    'account_function_logs',
    'account_auth_create_user',
    'account_auth_set_role',
    'account_auth_delete_user',
]);

/** These messages contain only fixed validation text, never remote response bodies. */
export class ManagementError extends Error {}

interface Scope {
    projectId: string;
    branchId: string;
}
interface CachedSource {
    deploymentId: number;
    source: string;
    language: 'javascript' | 'typescript';
}
const sources = new Map<string, CachedSource>();

function requireString(value: unknown, label: string, maxLength: number): string {
    if (
        typeof value !== 'string' ||
        !value.trim() ||
        value.length > maxLength ||
        /[\0\r\n]/.test(value)
    )
        throw new ManagementError(`Invalid ${label}`);
    return value;
}

function functionSlug(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-z0-9]{1,20}$/.test(value))
        throw new ManagementError('Function slug must contain 1–20 lowercase letters or digits');
    return value;
}

function sourceKey(scope: Scope, slug: string): string {
    return `${scope.projectId}:${scope.branchId}:${slug}`;
}

function item(value: NeonFunction) {
    return {
        slug: value.slug,
        name: value.name || value.slug,
        url: value.invocation_url || null,
        status: value.current_deployment?.status ?? 'not_deployed',
        deploymentId: value.current_deployment ? String(value.current_deployment.id) : null,
        updatedAt: value.current_deployment?.created_at ?? value.created_at ?? null,
    };
}

function environmentPatch(value: unknown): Record<string, string> | undefined {
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new ManagementError('Environment changes must be an object');
    const entries = Object.entries(value);
    if (entries.length > 64)
        throw new ManagementError('At most 64 environment changes are allowed');
    const result: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const [key, entry] of entries) {
        if (entry === '')
            throw new ManagementError(
                'Use null to remove an environment variable; empty values are not supported',
            );
        if (
            !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) ||
            (entry !== null && (typeof entry !== 'string' || entry.includes('\0')))
        )
            throw new ManagementError('Invalid environment variable name or value');
        result[key] = entry === null ? '' : (entry as string);
    }
    if (Buffer.byteLength(JSON.stringify(result)) > 24576)
        throw new ManagementError('Environment changes exceed 24 KiB');
    return entries.length ? result : undefined;
}

async function zipSource(source: unknown, language: unknown): Promise<File | undefined> {
    if (source === undefined) {
        if (language !== undefined)
            throw new ManagementError('Language changes require source code');
        return undefined;
    }
    const compiled = await compileFunction(source, language);
    if (!compiled.valid) {
        const error = compiled.diagnostics[0];
        throw new ManagementError(
            `Function validation failed (${error.line}:${error.column}): ${error.message}`,
        );
    }
    const zip = zipSync({'index.mjs': strToU8(compiled.code!)});
    return new File([Buffer.from(zip)], 'function.zip', {type: 'application/zip'});
}

async function responseText(response: Response): Promise<string> {
    if (!response.body) return '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let length = 0;
    let text = '';
    try {
        while (true) {
            const next = await reader.read();
            if (next.done) break;
            length += next.value.byteLength;
            if (length > 524288) {
                await reader.cancel();
                throw new ManagementError('Function response exceeds 512 KiB');
            }
            text += decoder.decode(next.value, {stream: true});
        }
        return text + decoder.decode();
    } finally {
        reader.releaseLock();
    }
}

function invocationUrl(value: string, scope: Scope, slug: string): URL {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new ManagementError('This function has no valid invocation endpoint');
    }
    if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.port ||
        url.search ||
        url.hash ||
        !url.hostname.startsWith(`${scope.branchId}-${slug}.`) ||
        !url.hostname.endsWith('.neon.tech')
    )
        throw new ManagementError(
            'The function invocation endpoint is not a trusted Neon endpoint',
        );
    return url;
}

/** Management mutations are only reached through the Core's administrator-only account transport. */
export async function manage(
    client: NeonClient<true>,
    method: string,
    args: Params,
    scope: Scope,
    fetcher: typeof fetch,
): Promise<unknown> {
    if (!managementMethods.has(method))
        throw new ManagementError('Unsupported Neon management method');
    if (method === 'account_functions_list') {
        const values = await client.functions.list({...scope, limit: 100}).all();
        return {functions: values.map(item)};
    }
    if (method === 'account_auth_create_user') {
        const email = requireString(args.email, 'email address', 320).trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            throw new ManagementError('Invalid email address');
        const name =
            args.name === undefined || args.name === ''
                ? undefined
                : requireString(args.name, 'display name', 200).trim();
        if (args.password !== undefined)
            throw new ManagementError('Neon account management cannot set user passwords');
        if (args.role !== undefined && args.role !== 'user')
            throw new ManagementError('Assign elevated roles after creating the user');
        const created = await client.auth.users.create({...scope, email, ...(name ? {name} : {})});
        return {id: created.id};
    }
    if (method === 'account_auth_set_role' || method === 'account_auth_delete_user') {
        const authUserId = requireString(args.userId, 'user ID', 128);
        if (method === 'account_auth_delete_user') {
            await client.auth.users.delete({...scope, authUserId});
            return null;
        }
        if (args.role !== 'user' && args.role !== 'admin')
            throw new ManagementError('Role must be user or admin');
        await client.auth.users.updateRole({...scope, authUserId, roles: [args.role]});
        return null;
    }
    if (method === 'account_function_validate') {
        const {valid, diagnostics, bundleBytes} = await compileFunction(args.source, args.language);
        return {valid, diagnostics, bundleBytes};
    }
    const slug = functionSlug(args.slug);
    const key = sourceKey(scope, slug);
    if (method === 'account_function_deploy') {
        if (args.createOnly !== undefined && typeof args.createOnly !== 'boolean')
            throw new ManagementError('Invalid function creation mode');
        const environment = environmentPatch(args.envChanges);
        const zip = await zipSource(args.source, args.language);
        if (!zip && !environment)
            throw new ManagementError('Provide source code or environment changes to deploy');
        if (args.createOnly === true) {
            if (!zip) throw new ManagementError('A new function requires source code');
            try {
                await client.functions.get({...scope, slug});
                throw new ManagementError(
                    'A function with this slug already exists; open it to confirm a replacement',
                );
            } catch (error) {
                if (!(isNeonError(error) && 'status' in error && error.status === 404)) throw error;
            }
        }
        let rememberedSource = typeof args.source === 'string' ? args.source : undefined;
        const cached = sources.get(key);
        if (!zip && cached) {
            const current = await client.functions.get({...scope, slug});
            if (current.current_deployment?.id === cached.deploymentId)
                rememberedSource = cached.source;
        }
        const deployment = await client.functions.deploy({
            ...scope,
            slug,
            runtime: 'nodejs24',
            ...(zip ? {zip} : {}),
            ...(environment ? {environment: JSON.stringify(environment)} : {}),
        });
        if (rememberedSource !== undefined) {
            if (sources.size >= 100) sources.delete(sources.keys().next().value!);
            sources.set(key, {
                deploymentId: deployment.id,
                source: rememberedSource,
                language: zip
                    ? args.language === 'typescript'
                        ? 'typescript'
                        : 'javascript'
                    : cached!.language,
            });
        }
        return {id: String(deployment.id), status: deployment.status};
    }
    if (method === 'account_function_delete') {
        await client.functions.delete({...scope, slug});
        sources.delete(key);
        return null;
    }
    if (method === 'account_function_rename')
        return item(
            await client.functions.update({
                ...scope,
                slug,
                name: requireString(args.name, 'function display name', 200).trim(),
            }),
        );
    const value = await client.functions.get({...scope, slug});
    if (method === 'account_function_get') {
        const cached = sources.get(key);
        return {
            ...item(value),
            source:
                cached && cached.deploymentId === value.current_deployment?.id
                    ? cached.source
                    : null,
            language:
                cached && cached.deploymentId === value.current_deployment?.id
                    ? cached.language
                    : 'javascript',
            activeDeploymentId: value.active_deployment ? String(value.active_deployment.id) : null,
            environmentKeys: value.current_deployment?.environment ?? [],
            error: value.current_deployment?.error ?? null,
        };
    }
    if (method === 'account_function_logs') {
        try {
            const page = await client.logs
                .query({...scope, source: 'function', since: '1h', limit: 100, sort_order: 'desc'})
                .page();
            return {
                available: true,
                entries: page.items
                    .filter((record) => record.entity_id === value.id)
                    .map((record) => ({
                        timestamp: record.timestamp,
                        level: record.severity_text ?? 'INFO',
                        message: record.message,
                    })),
                reason: 'Latest 100 branch records in the past hour, filtered to this function.',
            };
        } catch (error) {
            if (
                isNeonError(error) &&
                'status' in error &&
                (error.status === 404 || error.status === 403)
            )
                return {
                    available: false,
                    entries: [],
                    reason: 'Function logs are unavailable for this branch or API key.',
                };
            throw error;
        }
    }
    if (method === 'account_function_invoke') {
        if (args.method !== 'GET' && args.method !== 'POST')
            throw new ManagementError('Invocation method must be GET or POST');
        if (
            args.body !== undefined &&
            (typeof args.body !== 'string' || Buffer.byteLength(args.body) > 65536)
        )
            throw new ManagementError('Request body must be at most 64 KiB');
        if (args.method === 'GET' && args.body)
            throw new ManagementError('GET requests cannot include a body');
        const url = invocationUrl(value.invocation_url, scope, slug);
        try {
            const response = await fetcher(url, {
                method: args.method,
                ...(args.method === 'POST'
                    ? {
                          body: args.body as string | undefined,
                          headers: {'content-type': 'application/json'},
                      }
                    : {}),
                redirect: 'manual',
                signal: AbortSignal.timeout(15000),
            });
            return {status: response.status, body: await responseText(response)};
        } catch (error) {
            if (error instanceof ManagementError) throw error;
            throw new ManagementError('Function invocation failed or timed out');
        }
    }
    throw new ManagementError('Unsupported Neon management method');
}
