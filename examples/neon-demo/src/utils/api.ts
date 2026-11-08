import 'server-only';
import {auth} from './auth';

export class HttpError extends Error {
    constructor(
        public status: number,
        message: string,
    ) {
        super(message);
    }
}
export async function requireUser(request: Request) {
    if (!['GET', 'HEAD'].includes(request.method)) {
        const origin = request.headers.get('origin');
        const expected = process.env.APP_ORIGIN || new URL(request.url).origin;
        if (origin !== expected) throw new HttpError(403, 'Request origin is not allowed');
    }
    const {data} = await auth.getSession();
    if (!data?.user) throw new HttpError(401, 'Sign in to continue');
    const pageUser = request.headers.get('x-workspace-user');
    if (pageUser && pageUser !== data.user.id)
        throw new HttpError(409, 'Your session changed. Reload the workspace.');
    return data.user;
}
export function handleError(error: unknown): Response {
    if (error instanceof HttpError)
        return Response.json({error: error.message}, {status: error.status});
    if (error instanceof SyntaxError) return Response.json({error: 'Invalid JSON'}, {status: 400});
    console.error(
        'Workspace request failed',
        error instanceof Error ? error.name : 'Unknown error',
    );
    return Response.json(
        {error: 'The service could not complete this request. Try again.'},
        {status: 502},
    );
}
export function privateJson(value: unknown, status = 200) {
    return Response.json(value, {
        status,
        headers: {'Cache-Control': 'private, no-store'},
    });
}
