export function parseResource(id: string):
    | {
          service: 'functions' | 'users';
          functionSlug?: string;
          createFunction?: boolean;
          authUserId?: string;
      }
    | undefined {
    if (id === 'function-create') return {service: 'functions', createFunction: true};
    try {
        if (id.startsWith('function:')) {
            const slug = decodeURIComponent(id.slice('function:'.length));
            if (/^[a-z0-9]{1,20}$/.test(slug)) return {service: 'functions', functionSlug: slug};
        }
        if (id.startsWith('auth-user:')) {
            const userId = decodeURIComponent(id.slice('auth-user:'.length));
            if (
                userId &&
                userId.length <= 256 &&
                [...userId].every((char) => char.charCodeAt(0) >= 32)
            )
                return {service: 'users', authUserId: userId};
        }
    } catch {
        return undefined;
    }
}
