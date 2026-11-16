import {describe, expect, it} from 'vitest';
import {
    addNewIssues,
    candidateIssues,
    issueNumbers,
    issueStatus,
    localeGaps,
    updateBody,
} from '../../../../scripts/sync-contribute-discussion.mjs';

const today = new Date(Date.UTC(2026, 9, 12));

const body = [
    '**Status legend** (updated October 9, 2026): 🟢 Available',
    '',
    '| Issue | Label | Status |',
    '|---|---|---|',
    '| #852 Filter bar: contains | good first issue | 🔧 PR open (#927) |',
    '| #861 Catppuccin (Latte and Mocha) | good first issue | ✅ Done ([registry](https://example.test)) |',
    '| #863 Rosé Pine (Dawn and Main) | good first issue | 🔧 Approved, registry submission pending |',
    '',
    'Tabularis is available in 3 languages.',
    'with `en.json` as the reference (2,344 strings today).',
    '| Italian | `it.json` | 72 |',
].join('\n');

describe('issueStatus', () => {
    it('lists the merged PRs of a completed issue', () => {
        const issue = {
            state: 'CLOSED',
            stateReason: 'COMPLETED',
            prs: [
                {number: 897, state: 'MERGED'},
                {number: 933, state: 'MERGED'},
            ],
        };
        expect(issueStatus(issue, '🔧 PR open (#897)')).toBe('✅ Done (#897, #933)');
    });

    it('keeps a hand-written done note when no PR closed the issue', () => {
        const issue = {state: 'CLOSED', stateReason: 'COMPLETED', prs: []};
        expect(issueStatus(issue, '✅ Done (in the registry)')).toBe('✅ Done (in the registry)');
        expect(issueStatus(issue, '🙋 Taken')).toBe('✅ Done');
    });

    it('marks issues closed as not planned', () => {
        expect(
            issueStatus({state: 'CLOSED', stateReason: 'NOT_PLANNED', prs: []}, '🟢 Available'),
        ).toBe('⚪ Closed');
    });

    it('prefers open PRs, then assignment', () => {
        expect(
            issueStatus(
                {state: 'OPEN', assigned: true, prs: [{number: 1, state: 'OPEN'}]},
                '🙋 Taken',
            ),
        ).toBe('🔧 PR open (#1)');
        expect(issueStatus({state: 'OPEN', assigned: true, prs: []}, '🟢 Available')).toBe(
            '🙋 Taken',
        );
        expect(issueStatus({state: 'OPEN', assigned: false, prs: []}, '🙋 Taken')).toBe(
            '🟢 Available',
        );
    });

    it('keeps a manual 🔧 note but drops a stale PR reference', () => {
        const issue = {state: 'OPEN', assigned: true, prs: [{number: 9, state: 'CLOSED'}]};
        expect(issueStatus(issue, '🔧 In review elsewhere')).toBe('🔧 In review elsewhere');
        expect(issueStatus(issue, '🔧 PR open (#9)')).toBe('🙋 Taken');
    });
});

describe('localeGaps', () => {
    it('counts nested keys missing from each locale', () => {
        const result = localeGaps({en: {a: 'A', b: {c: 'C', d: 'D'}}, it: {a: 'A', b: {c: 'C'}}});
        expect(result).toEqual({total: 3, languages: 2, gaps: {it: 1}});
    });
});

describe('updateBody', () => {
    const issues = {
        852: {state: 'CLOSED', stateReason: 'COMPLETED', prs: [{number: 927, state: 'MERGED'}]},
        861: {state: 'CLOSED', stateReason: 'COMPLETED', prs: []},
        863: {state: 'OPEN', assigned: true, prs: []},
    };

    it('finds every issue row', () => {
        expect(issueNumbers(body)).toEqual([852, 861, 863]);
    });

    it('refreshes statuses, locale counts and the date', () => {
        const locales = {total: 2394, languages: 11, gaps: {it: 70}};
        const next = updateBody(body, {issues, locales, today});
        expect(next).toContain('(updated October 12, 2026)');
        expect(next).toContain('| #852 Filter bar: contains | good first issue | ✅ Done (#927) |');
        expect(next).toContain('✅ Done ([registry](https://example.test))');
        expect(next).toContain('🔧 Approved, registry submission pending');
        expect(next).toContain('(2,394 strings today)');
        expect(next).toContain('available in 11 languages');
        expect(next).toContain('| Italian | `it.json` | 70 |');
    });

    it('leaves the body and its date untouched when nothing changed', () => {
        const settled = updateBody(body, {issues, locales: null, today});
        expect(
            updateBody(settled, {issues, locales: null, today: new Date(Date.UTC(2027, 0, 1))}),
        ).toBe(settled);
    });
});

describe('new issues', () => {
    const nodes = [
        {
            number: 994,
            title: '[Feat]: SQL editor: show invisible characters',
            state: 'OPEN',
            stateReason: null,
            createdAt: '2026-10-11T10:00:00Z',
            labels: {nodes: [{name: 'enhancement'}, {name: 'good first issue'}]},
        },
        {
            number: 1017,
            title: '[Feat]: Trino | driver',
            state: 'OPEN',
            stateReason: null,
            createdAt: '2026-10-12T10:00:00Z',
            labels: {nodes: [{name: 'help wanted'}]},
        },
        {
            number: 900,
            title: 'Closed as not planned',
            state: 'CLOSED',
            stateReason: 'NOT_PLANNED',
            createdAt: '2026-10-10T10:00:00Z',
            labels: {nodes: [{name: 'help wanted'}]},
        },
        {
            number: 195,
            title: 'Older call for contributors',
            state: 'OPEN',
            stateReason: null,
            createdAt: '2026-05-14T10:00:00Z',
            labels: {nodes: [{name: 'help wanted'}]},
        },
        {
            number: 852,
            title: 'Already listed',
            state: 'OPEN',
            stateReason: null,
            createdAt: '2026-10-07T10:00:00Z',
            labels: {nodes: [{name: 'good first issue'}]},
        },
    ];
    const listed = `${body}\n\n## How to get started\n\n1. Read CONTRIBUTING.md.`;

    it('keeps labelled issues opened since the discussion, minus unplanned ones', () => {
        expect(candidateIssues(nodes, '2026-10-06T18:49:50Z').map((issue) => issue.number)).toEqual(
            [994, 1017, 852],
        );
    });

    it('adds unlisted issues to an auto-managed section before the guide', () => {
        const candidates = candidateIssues(nodes, '2026-10-06T18:49:50Z');
        const next = addNewIssues(listed, candidates);
        expect(next.indexOf('## 🆕 More issues to pick up')).toBeLessThan(
            next.indexOf('## How to get started'),
        );
        expect(next).toContain(
            '| #994 SQL editor: show invisible characters | good first issue | 🟢 Available |',
        );
        expect(next).toContain('| #1017 Trino \\| driver | help wanted | 🟢 Available |');
        expect(issueNumbers(next).filter((n) => n === 852)).toHaveLength(1);
        expect(addNewIssues(next, candidates)).toBe(next);
    });

    it('appends later issues inside the existing section', () => {
        const first = addNewIssues(listed, [{number: 994, title: 'A', label: 'good first issue'}]);
        const second = addNewIssues(first, [{number: 1017, title: 'B', label: 'help wanted'}]);
        expect(second.match(/## 🆕 More issues/g)).toHaveLength(1);
        expect(second).toContain(
            '| #994 A | good first issue | 🟢 Available |\n| #1017 B | help wanted | 🟢 Available |\n<!-- sync:new-issues:end -->',
        );
    });

    it('fills statuses of the added rows and moves the date', () => {
        const issues = {994: {state: 'OPEN', assigned: true, prs: []}};
        const next = updateBody(listed, {
            issues,
            locales: null,
            today,
            candidates: [{number: 994, title: 'A', label: 'good first issue'}],
        });
        expect(next).toContain('| #994 A | good first issue | 🙋 Taken |');
        expect(next).toContain('(updated October 12, 2026)');
    });
});
