import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';

export function start() {
    const child = spawn(
        process.execPath,
        [fileURLToPath(new URL('../dist/driver.js', import.meta.url))],
        {stdio: ['pipe', 'pipe', 'inherit']},
    );
    let next = 0;
    const pending = new Map();
    createInterface({input: child.stdout}).on('line', (line) => {
        const response = JSON.parse(line);
        const entry = pending.get(response.id);
        if (!entry) return;
        pending.delete(response.id);
        clearTimeout(entry.timer);
        if (response.error)
            entry.reject(
                Object.assign(new Error(response.error.message), {code: response.error.code}),
            );
        else entry.resolve(response.result);
    });
    child.on('exit', () => {
        for (const entry of pending.values()) {
            clearTimeout(entry.timer);
            entry.reject(new Error('Plugin exited'));
        }
        pending.clear();
    });
    return {
        call(method, params = {}) {
            return new Promise((resolve, reject) => {
                const id = ++next;
                const timer = setTimeout(() => {
                    pending.delete(id);
                    reject(new Error(`RPC ${method} timed out`));
                }, 45000);
                pending.set(id, {resolve, reject, timer});
                child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', id, method, params})}\n`);
            });
        },
        close() {
            child.stdin.end();
            child.kill();
        },
    };
}
