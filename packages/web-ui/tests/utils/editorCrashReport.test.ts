import {describe, it, expect} from 'vitest';
import {
    buildEditorCrashIssueUrl,
    formatEditorCrashReport,
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

    it('keeps long reports within a URL GitHub accepts', () => {
        const url = buildEditorCrashIssueUrl(report({stack: 'x'.repeat(50_000)}));
        expect(url.length).toBeLessThan(8192);
    });

    it('never puts a credential in the URL', () => {
        const url = buildEditorCrashIssueUrl(
            report({message: 'postgres://u:hunter2@h failed', stack: 'token=hunter2'}),
        );
        expect(decodeURIComponent(url)).not.toContain('hunter2');
    });
});
