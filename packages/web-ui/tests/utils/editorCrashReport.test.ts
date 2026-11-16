import {describe, it, expect} from 'vitest';
import {
    buildEditorCrashIssueUrl,
    CRASH_LOG_TRUNCATED_NOTE,
    formatEditorCrashReport,
    MAX_CRASH_ISSUE_URL_LENGTH,
    redactCrashText,
    type EditorCrashReport,
} from '@/utils/editorCrashReport';

const report = (overrides: Partial<EditorCrashReport> = {}): EditorCrashReport => ({
    message: 'Importing a module script failed.',
    stack: 'TypeError: Importing a module script failed.\n    at loadMonaco (LazyMonaco.tsx:12)',
    componentStack: '\n    at LazyMonaco\n    at Editor',
    appVersion: '0.30.0',
    platform: 'MacIntel',
    mode: 'desktop',
    ...overrides,
});

describe('redactCrashText', () => {
    it('removes credentials from connection URLs', () => {
        expect(redactCrashText('connect postgres://admin:hunter2@db.local:5432/app failed')).toBe(
            'connect postgres://[redacted]@db.local:5432/app failed',
        );
    });

    it('removes password, token and key values in key=value and JSON forms', () => {
        expect(redactCrashText('host=db password=hunter2 user=admin')).toBe(
            'host=db password=[redacted] user=admin',
        );
        expect(redactCrashText('{"password":"hunter2","apiKey": "sk-123"}')).toBe(
            '{"password":"[redacted]","apiKey": "[redacted]"}',
        );
        expect(redactCrashText('Authorization: Bearer abc.def.ghi')).toBe(
            'Authorization: Bearer [redacted]',
        );
    });

    it('removes values whose key ends in a credential word', () => {
        expect(
            redactCrashText(
                'access_token=abc client_secret=def DB_PASSWORD=ghi refresh-token: jkl {"db_password":"mno"}',
            ),
        ).toBe(
            'access_token=[redacted] client_secret=[redacted] DB_PASSWORD=[redacted] refresh-token: [redacted] {"db_password":"[redacted]"}',
        );
    });

    it('leaves ordinary stack frames alone', () => {
        const frame = '    at loadMonaco (http://localhost:1420/src/LazyMonaco.tsx:12:5)';
        expect(redactCrashText(frame)).toBe(frame);
    });
});

describe('formatEditorCrashReport', () => {
    it('includes the message, version, platform, mode and both stacks', () => {
        expect(formatEditorCrashReport(report())).toBe(
            [
                'Message: Importing a module script failed.',
                'Tabularis version: 0.30.0',
                'Platform: MacIntel',
                'Mode: desktop',
                'Error stack:\nTypeError: Importing a module script failed.\n    at loadMonaco (LazyMonaco.tsx:12)',
                'Component stack:\nat LazyMonaco\n    at Editor',
            ].join('\n\n'),
        );
    });

    it('leaves out stacks that are missing', () => {
        const text = formatEditorCrashReport(report({stack: null, componentStack: null}));
        expect(text).not.toContain('Error stack');
        expect(text).not.toContain('Component stack');
    });

    it('redacts the message and stacks', () => {
        const text = formatEditorCrashReport(
            report({
                message: 'failed for mysql://root:secret@localhost',
                stack: 'Error: password=secret',
            }),
        );
        expect(text).not.toContain('secret');
    });
});

describe('buildEditorCrashIssueUrl', () => {
    it('targets the bug report form with its field ids', () => {
        const url = new URL(buildEditorCrashIssueUrl(report()));
        expect(`${url.origin}${url.pathname}`).toBe(
            'https://github.com/TabularisDB/tabularis/issues/new',
        );
        expect(url.searchParams.get('template')).toBe('bug_report.yml');
        expect(url.searchParams.get('title')).toBe(
            '[Bug]: Editor crashed: Importing a module script failed.',
        );
        expect(url.searchParams.get('os')).toBe('MacIntel');
        expect(url.searchParams.get('app-version')).toBe('v0.30.0');
        expect(url.searchParams.get('logs')).toBe(formatEditorCrashReport(report()));
        expect(url.searchParams.has('reproduction')).toBe(false);
    });

    it.each([
        ['a long ASCII stack', {stack: 'x'.repeat(50_000)}],
        ['a non-ASCII stack', {stack: '界'.repeat(6000), componentStack: null}],
        [
            'a multi-line stack',
            {
                stack: Array.from(
                    {length: 2000},
                    (_, i) => `    at frame${i} (a "b" c.tsx:1:2)`,
                ).join('\n'),
            },
        ],
        ['a long message', {message: 'x'.repeat(10_000), stack: null, componentStack: null}],
        ['a long non-ASCII message', {message: '界'.repeat(10_000)}],
    ])('keeps the encoded URL within GitHub limits for %s', (_, overrides) => {
        const url = buildEditorCrashIssueUrl(report(overrides));
        expect(url.length).toBeLessThanOrEqual(MAX_CRASH_ISSUE_URL_LENGTH);
        expect(MAX_CRASH_ISSUE_URL_LENGTH).toBeLessThan(8192);
    });

    it('marks a shortened log and keeps as much of it as fits', () => {
        const url = buildEditorCrashIssueUrl(report({stack: '界'.repeat(6000)}));
        const logs = new URL(url).searchParams.get('logs') ?? '';
        expect(logs.startsWith('Message: Importing a module script failed.')).toBe(true);
        expect(logs.endsWith(CRASH_LOG_TRUNCATED_NOTE)).toBe(true);
        expect(logs.length).toBeGreaterThan(500);
    });

    it('caps the message in the title and description', () => {
        const url = new URL(buildEditorCrashIssueUrl(report({message: 'x'.repeat(10_000)})));
        expect(url.searchParams.get('title')!.length).toBeLessThanOrEqual(110);
        expect(url.searchParams.get('description')!.length).toBeLessThanOrEqual(330);
    });

    it('does not split a surrogate pair when shortening', () => {
        const url = buildEditorCrashIssueUrl(report({stack: '😀'.repeat(6000)}));
        const logs = new URL(url).searchParams.get('logs') ?? '';
        expect(logs).not.toContain('\uFFFD');
    });

    it('never puts a credential in the URL', () => {
        const url = buildEditorCrashIssueUrl(
            report({message: 'postgres://u:hunter2@h failed', stack: 'token=hunter2'}),
        );
        expect(decodeURIComponent(url)).not.toContain('hunter2');
    });
});
