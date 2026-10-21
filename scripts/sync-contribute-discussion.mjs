// Refreshes the "Good first issues" discussion: issue statuses in its tables,
// translation gap counts and the "updated" date. Issues labelled
// `good first issue` or `help wanted` since the discussion was opened and not
// listed yet are appended to an auto-managed section; moving a row into a
// themed section by hand is kept, since only unlisted issues are added. Run by
// .github/workflows/sync-contribute-discussion.yml every 6 hours.
//
//   GH_TOKEN=... node scripts/sync-contribute-discussion.mjs [--dry-run]
//
// Hand-written cells survive when GitHub has nothing better to say: a ✅ note
// such as a registry link on an issue closed without a PR, or a 🔧 note with
// no PR number on an open issue (work happening in another repository).
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const OWNER = 'TabularisDB';
const REPO = 'tabularis';
const LOCALES_DIR = 'src/i18n/locales';
const ROW = /^\| #(\d+) (.+) \| ([^|]+) \| ([^|]+) \|$/;
const LOCALE_ROW = /^(\| [^|]+ \| `([\w-]+)\.json` \| )(\d+)( \|)$/;
const LABELS = ['good first issue', 'help wanted'];
const NEW_START = '<!-- sync:new-issues:start -->';
const NEW_END = '<!-- sync:new-issues:end -->';
const NEW_HEADING = '## 🆕 More issues to pick up';
const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
];

export function formatDate(date) {
    return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

const prList = (prs) => prs.map((n) => `#${n}`).join(', ');

/** Status cell for one issue; `current` is the cell as it reads today. */
export function issueStatus(issue, current) {
    const prs = issue.prs ?? [];
    if (issue.state === 'CLOSED') {
        if (issue.stateReason && issue.stateReason !== 'COMPLETED') return '⚪ Closed';
        const merged = prs.filter((pr) => pr.state === 'MERGED').map((pr) => pr.number);
        if (merged.length) return `✅ Done (${prList(merged)})`;
        return current.startsWith('✅') ? current : '✅ Done';
    }
    const open = prs.filter((pr) => pr.state === 'OPEN').map((pr) => pr.number);
    if (open.length) return `🔧 PR open (${prList(open)})`;
    if (current.startsWith('🔧') && !/#\d/.test(current)) return current;
    return issue.assigned ? '🙋 Taken' : '🟢 Available';
}

/** Missing key count per locale file, against en.json. */
export function localeGaps(locales) {
    const flat = (obj, prefix = '') =>
        Object.entries(obj).flatMap(([key, value]) =>
            value && typeof value === 'object'
                ? flat(value, `${prefix}${key}.`)
                : [`${prefix}${key}`],
        );
    const reference = flat(locales.en);
    const gaps = {};
    for (const [code, data] of Object.entries(locales)) {
        if (code === 'en') continue;
        const keys = new Set(flat(data));
        gaps[code] = reference.filter((key) => !keys.has(key)).length;
    }
    return {total: reference.length, languages: Object.keys(locales).length, gaps};
}

export function issueNumbers(body) {
    return [
        ...new Set(
            body.split('\n').flatMap((line) => {
                const match = line.match(ROW);
                return match ? [Number(match[1])] : [];
            }),
        ),
    ];
}

/** Strips issue-template prefixes such as "[Feat]: " and table-breaking pipes. */
export function rowTitle(title) {
    return title
        .replace(/^\[[^\]]+\]:?\s*/, '')
        .replaceAll('|', '\\|')
        .trim();
}

/**
 * Appends unlisted candidates to the auto-managed section, created before
 * "## How to get started" on first use. Status cells are filled in later.
 */
export function addNewIssues(body, candidates) {
    const listed = new Set(issueNumbers(body));
    const fresh = candidates
        .filter((issue) => !listed.has(issue.number))
        .sort((a, b) => a.number - b.number);
    if (!fresh.length) return body;
    const rows = fresh.map(
        (issue) => `| #${issue.number} ${rowTitle(issue.title)} | ${issue.label} | 🟢 Available |`,
    );
    const start = body.indexOf(NEW_START);
    const end = body.indexOf(NEW_END);
    if (start >= 0 && end > start) {
        const section = body.slice(start, end).replace(/\n+$/, '');
        return `${body.slice(0, start)}${section}\n${rows.join('\n')}\n${body.slice(end)}`;
    }
    const section = [
        NEW_HEADING,
        '',
        'New issues land here automatically.',
        '',
        NEW_START,
        '| Issue | Label | Status |',
        '|---|---|---|',
        ...rows,
        NEW_END,
        '',
        '',
    ].join('\n');
    const anchor = body.indexOf('## How to get started');
    return anchor >= 0
        ? body.slice(0, anchor) + section + body.slice(anchor)
        : `${body.trimEnd()}\n\n${section}`;
}

/** Labelled issues worth listing: opened since `since`, not closed as unplanned. */
export function candidateIssues(nodes, since) {
    return nodes
        .filter((issue) => issue.createdAt >= since)
        .filter((issue) => issue.state === 'OPEN' || issue.stateReason === 'COMPLETED')
        .map((issue) => {
            const names = issue.labels.nodes.map((label) => label.name);
            return {
                number: issue.number,
                title: issue.title,
                label: LABELS.find((label) => names.includes(label)),
            };
        })
        .filter((issue) => issue.label);
}

/** Returns the refreshed body; the date only moves when something else did. */
export function updateBody(body, {issues, locales, today, candidates = []}) {
    const lines = addNewIssues(body, candidates)
        .split('\n')
        .map((line) => {
            const row = line.match(ROW);
            if (row && issues[row[1]]) {
                const status = issueStatus(issues[row[1]], row[4]);
                return `| #${row[1]} ${row[2]} | ${row[3]} | ${status} |`;
            }
            const locale = locales && line.match(LOCALE_ROW);
            if (locale && locale[2] in locales.gaps)
                return `${locale[1]}${locales.gaps[locale[2]]}${locale[4]}`;
            return line;
        });
    let next = lines.join('\n');
    if (locales) {
        next = next
            .replace(
                /\(([\d,]+) strings today\)/,
                `(${locales.total.toLocaleString('en-US')} strings today)`,
            )
            .replace(/available in \d+ languages/, `available in ${locales.languages} languages`);
    }
    if (next === body) return body;
    return next.replace(/\(updated [A-Z][a-z]+ \d{1,2}, \d{4}\)/, `(updated ${formatDate(today)})`);
}

async function graphql(query, variables) {
    const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.GH_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({query, variables}),
    });
    const json = await response.json();
    if (!response.ok || json.errors)
        throw new Error(`GraphQL failed: ${JSON.stringify(json.errors ?? json)}`);
    return json.data;
}

async function fetchIssues(numbers) {
    const fields = numbers
        .map(
            (n) => `i${n}: issue(number: ${n}) {
    state stateReason assignees(first: 1) { totalCount }
    closedByPullRequestsReferences(first: 10) { nodes { number state repository { nameWithOwner } } }
  }`,
        )
        .join('\n');
    const data = await graphql(
        `query { repository(owner: "${OWNER}", name: "${REPO}") { ${fields} } }`,
    );
    const issues = {};
    for (const n of numbers) {
        const issue = data.repository[`i${n}`];
        if (!issue) continue;
        issues[n] = {
            state: issue.state,
            stateReason: issue.stateReason,
            assigned: issue.assignees.totalCount > 0,
            prs: issue.closedByPullRequestsReferences.nodes
                .filter((pr) => pr.repository.nameWithOwner === `${OWNER}/${REPO}`)
                .map(({number, state}) => ({number, state})),
        };
    }
    return issues;
}

async function fetchCandidates(since) {
    const data = await graphql(
        `query($labels: [String!]) { repository(owner: "${OWNER}", name: "${REPO}") {
    issues(labels: $labels, first: 100, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes { number title state stateReason createdAt labels(first: 20) { nodes { name } } }
    } } }`,
        {labels: LABELS},
    );
    return candidateIssues(data.repository.issues.nodes, since);
}

function readLocales(dir) {
    const locales = {};
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
        locales[file.slice(0, -5)] = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    }
    return locales;
}

async function main() {
    if (!process.env.GH_TOKEN) throw new Error('GH_TOKEN is required');
    const number = Number(process.env.DISCUSSION_NUMBER ?? 872);
    const dryRun = process.argv.includes('--dry-run');
    const {repository} = await graphql(
        `query($number: Int!) { repository(owner: "${OWNER}", name: "${REPO}") { discussion(number: $number) { id body createdAt } } }`,
        {number},
    );
    const {id, body, createdAt} = repository.discussion;
    const candidates = await fetchCandidates(createdAt);
    const issues = await fetchIssues(issueNumbers(addNewIssues(body, candidates)));
    const locales = localeGaps(readLocales(LOCALES_DIR));
    const next = updateBody(body, {issues, locales, today: new Date(), candidates});
    if (next === body) return console.log('Discussion already up to date.');
    if (dryRun) return console.log(next);
    await graphql(
        'mutation($id: ID!, $body: String!) { updateDiscussion(input: { discussionId: $id, body: $body }) { discussion { url } } }',
        {id, body: next},
    );
    console.log(`Updated discussion #${number}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
