import type {Token} from './index';

/** Firebird units retain declaration semicolons as well as nested BEGIN/CASE bodies. */
export interface PsqlState {
    readonly leading: string[];
    readonly stack: string[];
    parenDepth: number;
    inUnit: boolean;
    previous: string;
    localRoutine: boolean;
}

const WORD = /[A-Za-z_][A-Za-z0-9_$]*/y;
const WORD_CHAR = /[A-Za-z0-9_$]/;

export function createPsqlState(): PsqlState {
    return {
        leading: [],
        stack: [],
        parenDepth: 0,
        inUnit: false,
        previous: '',
        localRoutine: false,
    };
}

export function resetPsqlState(state: PsqlState): void {
    state.leading.length = 0;
    state.stack.length = 0;
    state.parenDepth = 0;
    state.inUnit = false;
    state.previous = '';
    state.localRoutine = false;
}

function isPsqlUnit(words: readonly string[]): boolean {
    if (words[0] === 'EXECUTE') return words[1] === 'BLOCK';
    if (!['CREATE', 'ALTER', 'RECREATE'].includes(words[0])) return false;
    const kind = words[1] === 'OR' && words[2] === 'ALTER' ? words[3] : words[1];
    return ['PROCEDURE', 'FUNCTION', 'TRIGGER', 'PACKAGE'].includes(kind);
}

/** Called only for code characters, outside quoted names, literals and comments. */
export function onPsqlCharacter(source: string, position: number, state: PsqlState): void {
    const ch = source[position];
    if (!WORD_CHAR.test(ch)) {
        if (ch === '(') state.parenDepth++;
        else if (ch === ')') state.parenDepth = Math.max(0, state.parenDepth - 1);
        return;
    }
    const before = position > 0 ? source[position - 1] : '';
    if (WORD_CHAR.test(before) || before === '.' || before === ':') return;
    WORD.lastIndex = position;
    const match = WORD.exec(source);
    if (!match) return;
    const word = match[0].toUpperCase();
    if (state.leading.length < 4) state.leading.push(word);
    if (!state.inUnit) {
        if (word === 'AS' && state.parenDepth === 0 && isPsqlUnit(state.leading)) {
            state.inUnit = true;
            state.stack.push('UNIT');
        }
        state.previous = word;
        return;
    }
    if (
        state.previous === 'DECLARE' &&
        (word === 'FUNCTION' || word === 'PROCEDURE') &&
        state.stack.at(-1) === 'UNIT'
    ) {
        state.localRoutine = true;
    }
    if (word === 'AS' && state.localRoutine && state.parenDepth === 0) {
        state.stack.push('UNIT');
        state.localRoutine = false;
    } else if (word === 'BEGIN') {
        if (state.stack.at(-1) === 'UNIT') state.stack[state.stack.length - 1] = 'BODY';
        else state.stack.push('BEGIN');
        state.localRoutine = false;
    } else if (word === 'CASE') {
        state.stack.push('CASE');
    } else if (word === 'END' && state.stack.length > 0) {
        state.stack.pop();
        if (state.stack.length === 0) state.inUnit = false;
    }
    state.previous = word;
}

/** isql SET TERM is a client directive, not a statement to send to the server. */
export function readPsqlTerminator(source: string, position: number, old: string): Token | null {
    const newline = source.indexOf('\n', position);
    const end = newline < 0 ? source.length : newline;
    const line = source.slice(position, end).replace(/\r$/, '');
    const prefix = /^SET[ \t]+TERM[ \t]+/i.exec(line);
    if (!prefix) return null;
    const escaped = old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`^(\\S+?)[ \\t]*${escaped}[ \\t]*(?:--.*)?$`).exec(
        line.slice(prefix[0].length),
    );
    const next = match?.[1];
    if (!next || next.includes("'") || next.includes(old)) return null;
    return {kind: 'setDelimiter', length: end - position, value: next};
}
