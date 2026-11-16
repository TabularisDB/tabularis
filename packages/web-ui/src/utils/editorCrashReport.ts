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
        /\b([\w-]*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key))(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi,
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
const MAX_DESCRIPTION_MESSAGE_LENGTH = 300;
const MAX_FIELD_LENGTH = 100;

/** Upper bound for the encoded Create issue URL; GitHub rejects new-issue URLs above about 8 KB. */
export const MAX_CRASH_ISSUE_URL_LENGTH = 8000;

/** Appended to the logs field when the report had to be shortened to fit the URL. */
export const CRASH_LOG_TRUNCATED_NOTE =
    '\n\n[Report shortened. Use Copy report to paste the full text.]';

/** Cuts text to at most max UTF-16 units without splitting a surrogate pair. */
function cut(text: string, max: number): string {
    if (text.length <= max) return text;
    const end = /[\uD800-\uDBFF]/.test(text.charAt(max - 1)) ? max - 1 : max;
    return text.slice(0, end);
}

function truncate(text: string, max: number): string {
    return text.length > max ? `${cut(text, max - 1)}…` : text;
}

function issueUrl(fields: Record<string, string>): string {
    return `${TABULARIS_REPO_URL}/issues/new?${new URLSearchParams(fields).toString()}`;
}

export function buildEditorCrashIssueUrl(report: EditorCrashReport): string {
    const message = redactCrashText(report.message);
    const fields = {
        template: 'bug_report.yml',
        title: `[Bug]: Editor crashed: ${truncate(message, MAX_TITLE_MESSAGE_LENGTH)}`,
        description: `The editor crashed with "${truncate(message, MAX_DESCRIPTION_MESSAGE_LENGTH)}".`,
        os: truncate(report.platform, MAX_FIELD_LENGTH),
        'app-version': truncate(`v${report.appVersion}`, MAX_FIELD_LENGTH),
    };
    const logs = formatEditorCrashReport(report);
    const full = issueUrl({...fields, logs});
    if (full.length <= MAX_CRASH_ISSUE_URL_LENGTH) return full;

    // Percent-encoding makes the encoded size depend on the content (newlines, quotes and
    // non-ASCII text grow 3-9x), so find the longest prefix of the log whose URL still fits.
    const shortened = (length: number) =>
        issueUrl({...fields, logs: `${cut(logs, length)}${CRASH_LOG_TRUNCATED_NOTE}`});
    let low = 0;
    let high = logs.length;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (shortened(mid).length <= MAX_CRASH_ISSUE_URL_LENGTH) low = mid;
        else high = mid - 1;
    }
    return shortened(low);
}
