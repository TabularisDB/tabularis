export type CrashReportMode = 'desktop' | 'web';

export interface EditorCrashReport {
    message: string;
    stack: string | null;
    componentStack: string | null;
    appVersion: string;
    platform: string;
    mode: CrashReportMode;
}

const REDACTED = '[redacted]';

const CREDENTIAL_PATTERNS: ReadonlyArray<[RegExp, string]> = [
    [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, `$1${REDACTED}@`],
    [
        /\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi,
        `$1$2${REDACTED}`,
    ],
    [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, `$1 ${REDACTED}`],
];

export function redactCrashText(text: string): string {
    return CREDENTIAL_PATTERNS.reduce(
        (result, [pattern, replacement]) => result.replace(pattern, replacement),
        text,
    );
}

export function formatEditorCrashReport(report: EditorCrashReport): string {
    const sections = [
        `Message: ${report.message}`,
        `Tabularis version: ${report.appVersion}`,
        `Platform: ${report.platform}`,
        `Mode: ${report.mode}`,
        report.stack && `Error stack:\n${report.stack}`,
        report.componentStack && `Component stack:\n${report.componentStack.trim()}`,
    ];
    return redactCrashText(sections.filter(Boolean).join('\n\n'));
}

const TABULARIS_REPO_URL = 'https://github.com/TabularisDB/tabularis';
const MAX_TITLE_MESSAGE_LENGTH = 80;
const MAX_LOG_LENGTH = 6000;

function truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function buildEditorCrashIssueUrl(report: EditorCrashReport): string {
    const message = redactCrashText(report.message);
    const params = new URLSearchParams();
    params.set('template', 'bug_report.yml');
    params.set('title', `[Bug]: Editor crashed: ${truncate(message, MAX_TITLE_MESSAGE_LENGTH)}`);
    params.set('description', `The editor crashed with "${message}".`);
    params.set('os', report.platform);
    params.set('app-version', `v${report.appVersion}`);
    params.set('logs', truncate(formatEditorCrashReport(report), MAX_LOG_LENGTH));
    return `${TABULARIS_REPO_URL}/issues/new?${params.toString()}`;
}
