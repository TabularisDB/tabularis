import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import {createRealtime, rawSql} from '@neon/realtime/server';
import {env} from './env.js';
import {text, type Params} from './database.js';

async function json(response: Response): Promise<unknown> {
    if (!response.ok) throw new Error(`Neon service returned HTTP ${response.status}`);
    return response.json();
}

export async function service(method: string, args: Params): Promise<unknown> {
    const timeout = AbortSignal.timeout(30000);
    switch (method) {
        case 'neon_auth_session':
            return json(
                await fetch(`${env('NEON_AUTH_BASE_URL')}/get-session`, {
                    headers: typeof args.cookie === 'string' ? {cookie: args.cookie} : {},
                    signal: timeout,
                }),
            );
        case 'neon_auth_sign_up':
        case 'neon_auth_sign_in':
        case 'neon_auth_sign_out': {
            const route =
                method === 'neon_auth_sign_up'
                    ? 'sign-up/email'
                    : method === 'neon_auth_sign_in'
                      ? 'sign-in/email'
                      : 'sign-out';
            const response = await fetch(`${env('NEON_AUTH_BASE_URL')}/${route}`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    origin: 'http://localhost:5173',
                    ...(typeof args.cookie === 'string' ? {cookie: args.cookie} : {}),
                },
                body: JSON.stringify(
                    method !== 'neon_auth_sign_out'
                        ? {
                              name: 'Tabularis',
                              email: text(args.email, 'email'),
                              password: text(args.password, 'password'),
                          }
                        : {},
                ),
                signal: timeout,
            });
            return {data: await json(response), cookies: response.headers.getSetCookie()};
        }
        case 'neon_function': {
            const response = await fetch(env('NEON_FUNCTION_HELLO_BASE_URL'), {signal: timeout});
            if (!response.ok) throw new Error(`Function returned HTTP ${response.status}`);
            return {status: response.status, body: await response.text()};
        }
        case 'neon_ai_models':
        case 'neon_ai_complete': {
            const base = env('NEON_AI_GATEWAY_BASE_URL');
            return json(
                await fetch(
                    `${base}/v1/${method === 'neon_ai_models' ? 'models' : 'chat/completions'}`,
                    {
                        method: method === 'neon_ai_models' ? 'GET' : 'POST',
                        headers: {
                            authorization: `Bearer ${env('NEON_AI_GATEWAY_TOKEN')}`,
                            'content-type': 'application/json',
                        },
                        ...(method === 'neon_ai_complete'
                            ? {
                                  body: JSON.stringify({
                                      model: text(args.model, 'model'),
                                      messages: [
                                          {role: 'user', content: text(args.prompt, 'prompt')},
                                      ],
                                      max_tokens: 64,
                                  }),
                              }
                            : {}),
                        signal: timeout,
                    },
                ),
            );
        }
        case 'neon_storage_list':
        case 'neon_storage_put':
        case 'neon_storage_get':
        case 'neon_storage_delete': {
            const s3 = new S3Client({
                endpoint: env('AWS_ENDPOINT_URL_S3'),
                region: env('AWS_REGION'),
                forcePathStyle: true,
                credentials: {
                    accessKeyId: env('AWS_ACCESS_KEY_ID'),
                    secretAccessKey: env('AWS_SECRET_ACCESS_KEY'),
                },
            });
            const Bucket = 'assets';
            try {
                if (method === 'neon_storage_list')
                    return (
                        (
                            await s3.send(
                                new ListObjectsV2Command({
                                    Bucket,
                                    Prefix:
                                        typeof args.prefix === 'string' ? args.prefix : undefined,
                                }),
                                {abortSignal: timeout},
                            )
                        ).Contents ?? []
                    );
                const Key = text(args.key, 'key');
                if (method === 'neon_storage_put') {
                    await s3.send(
                        new PutObjectCommand({
                            Bucket,
                            Key,
                            Body: text(args.body, 'body'),
                            ContentType: 'text/plain',
                        }),
                        {abortSignal: timeout},
                    );
                    return {key: Key};
                }
                if (method === 'neon_storage_get')
                    return {
                        body: await (
                            await s3.send(new GetObjectCommand({Bucket, Key}), {
                                abortSignal: timeout,
                            })
                        ).Body?.transformToString(),
                    };
                await s3.send(new DeleteObjectCommand({Bucket, Key}), {abortSignal: timeout});
                return null;
            } finally {
                s3.destroy();
            }
        }
        case 'neon_realtime_snapshot': {
            // This is a trusted local database tool, never a public query-sealing endpoint.
            const realtime = createRealtime({
                url: env('NEON_REALTIME_URL'),
                secret: env('NEON_REALTIME_SECRET'),
                db: decodeURIComponent(new URL(env('DATABASE_URL')).pathname.slice(1)),
            });
            try {
                const subscription = await realtime.subscribe(
                    rawSql<Record<string, unknown>>(text(args.query, 'query')),
                );
                const column = args.until !== undefined ? text(args.column, 'column') : '';
                let observedInitial = args.from === undefined;
                return await new Promise((resolve, reject) => {
                    const timer = setTimeout(
                        () => reject(new Error('Realtime snapshot timed out')),
                        30000,
                    );
                    const check = () => {
                        const snapshot = subscription.getSnapshot();
                        if (snapshot.status === 'error') {
                            clearTimeout(timer);
                            reject(snapshot.error);
                        } else if (snapshot.data !== undefined) {
                            if (!observedInitial) {
                                if (!snapshot.data.some((row) => row[column] === args.from)) {
                                    clearTimeout(timer);
                                    reject(new Error('Unexpected initial Realtime value'));
                                    return;
                                }
                                observedInitial = true;
                            }
                            if (
                                args.until === undefined ||
                                snapshot.data.some((row) => row[column] === args.until)
                            ) {
                                clearTimeout(timer);
                                resolve(snapshot.data);
                            }
                        }
                    };
                    subscription.onChange(check);
                    check();
                });
            } finally {
                realtime.close();
            }
        }
        default:
            throw new Error(`Unsupported Neon method: ${method}`);
    }
}
