export const serviceIds = [
    'overview',
    'users',
    'storage',
    'ai',
    'functions',
    'realtime',
    'setup',
] as const;
export type NeonService = (typeof serviceIds)[number] | 'database';
export const serviceIcons: Record<NeonService, string> = {
    overview: 'overview',
    database: 'database',
    users: 'users',
    storage: 'storage',
    ai: 'ai',
    functions: 'functions',
    realtime: 'realtime',
    setup: 'settings',
};
