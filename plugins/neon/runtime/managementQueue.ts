const pending = new Map<string, Promise<unknown>>();

/** Serialize local writes to one remote function, including create-only existence checks. */
export async function withFunctionMutation<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = pending.get(key) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(action);
    pending.set(key, task);
    try {
        return await task;
    } finally {
        if (pending.get(key) === task) pending.delete(key);
    }
}
