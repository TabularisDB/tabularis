// Statement bodies whose `;` belong to the statement: SQLite's
// `CREATE TRIGGER … BEGIN … END` and PostgreSQL's SQL-standard
// `BEGIN ATOMIC … END` function and procedure bodies. The splitter feeds it
// every word outside strings and comments. Neither body nests, but both may
// hold `CASE … END` expressions, so those are counted and their END does not
// close the body.

import type {DialectOptions} from './index';

export interface CompoundBodyState {
    /** The first words of the current statement, upper-cased. */
    readonly leading: string[];
    /** The previous word, upper-cased (`BEGIN` before `ATOMIC`). */
    previous: string;
    inBody: boolean;
    caseDepth: number;
}

const LEADING_WORDS = 3;
const WORD_RE = /[A-Za-z_][A-Za-z0-9_$]*/y;
const WORD_CHAR_RE = /[A-Za-z0-9_$]/;

export function createCompoundBodyState(): CompoundBodyState {
    return {leading: [], previous: '', inBody: false, caseDepth: 0};
}

/** True while a `;` belongs to an open body. */
export function isInsideBody(state: CompoundBodyState): boolean {
    return state.inBody;
}

/** Reset after a top-level statement boundary. */
export function resetCompoundBodyState(state: CompoundBodyState): void {
    state.leading.length = 0;
    state.previous = '';
    state.inBody = false;
    state.caseDepth = 0;
}

/** `CREATE [TEMP | TEMPORARY] TRIGGER`. */
function isCreateTrigger(leading: ReadonlyArray<string>): boolean {
    if (leading[0] !== 'CREATE') return false;
    const next = leading[1] === 'TEMP' || leading[1] === 'TEMPORARY' ? leading[2] : leading[1];
    return next === 'TRIGGER';
}

/**
 * Called on every code character outside strings and comments. Reads the
 * word starting at `position`, if any, and skips field names such as
 * `new.end`.
 */
export function onBodyCharacter(
    source: string,
    position: number,
    options: DialectOptions,
    state: CompoundBodyState,
): void {
    // Punctuation separates words: `begin, atomic` is not BEGIN ATOMIC.
    if (!WORD_CHAR_RE.test(source[position])) {
        state.previous = '';
        return;
    }
    const before = position > 0 ? source[position - 1] : '';
    if (WORD_CHAR_RE.test(before)) return;
    WORD_RE.lastIndex = position;
    const match = WORD_RE.exec(source);
    if (!match) return;
    if (before === '.') {
        state.previous = '';
        return;
    }

    const word = match[0].toUpperCase();
    if (state.leading.length < LEADING_WORDS) state.leading.push(word);

    if (state.inBody) {
        if (word === 'CASE') state.caseDepth++;
        else if (word === 'END') {
            if (state.caseDepth > 0) state.caseDepth--;
            else state.inBody = false;
        }
    } else if (
        (options.triggerBodies && word === 'BEGIN' && isCreateTrigger(state.leading)) ||
        (options.atomicBodies &&
            word === 'ATOMIC' &&
            state.previous === 'BEGIN' &&
            state.leading[0] === 'CREATE')
    ) {
        state.inBody = true;
        state.caseDepth = 0;
    }
    state.previous = word;
}
