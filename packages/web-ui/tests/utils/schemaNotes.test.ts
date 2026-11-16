import {describe, expect, it} from 'vitest';
import {
    columnsWithNotes,
    describeTarget,
    findNote,
    groupNotesByDomain,
    noteKey,
    noteTarget,
    sameTarget,
    schemaNotesFileName,
} from '@/utils/schemaNotes';
import type {SchemaNotesState} from '@/types/schemaNotes';

const state: SchemaNotesState = {
    projectNote: '',
    includeInAiContext: false,
    notes: [
        {schema: 'billing', table: 'orders', domain: 'Billing', note: 'Billing orders'},
        {schema: 'billing', table: 'orders', column: 'status', note: '4 = captured'},
        {schema: 'shop', table: 'orders', note: 'Shop orders'},
        {schema: 'shop', table: 'orders', column: 'gone', note: 'dropped column'},
        {schema: 'billing', table: 'payments', domain: 'Billing', note: ''},
        {schema: 'audit', table: 'events', domain: 'Audit', note: 'x'},
        {table: 'logs', column: 'level', note: 'only a column note'},
    ],
};

describe('schemaNotes', () => {
    describe('noteTarget', () => {
        it('drops empty levels and keeps the column', () => {
            expect(noteTarget({database: '', schema: null, table: 't'}, 'c')).toEqual({
                table: 't',
                column: 'c',
            });
            expect(noteTarget({database: 'db', schema: 's', table: 't'})).toEqual({
                database: 'db',
                schema: 's',
                table: 't',
            });
        });
    });

    describe('noteKey', () => {
        it('distinguishes the same table in different schemas', () => {
            expect(noteKey({schema: 'a', table: 't'})).not.toBe(noteKey({schema: 'b', table: 't'}));
            expect(sameTarget({schema: 'a', table: 't'}, {schema: 'a', table: 't'})).toBe(true);
        });

        it('cannot be confused by dots or quotes inside names', () => {
            expect(noteKey({schema: 'a.b', table: 'c'})).not.toBe(
                noteKey({schema: 'a', table: 'b.c'}),
            );
            expect(noteKey({table: 'a"],["b'})).not.toBe(noteKey({table: 'a', column: 'b'}));
        });
    });

    describe('findNote', () => {
        it('finds by full identity only', () => {
            expect(findNote(state, {schema: 'shop', table: 'orders'})?.note).toBe('Shop orders');
            expect(findNote(state, {table: 'orders'})).toBeUndefined();
            expect(
                findNote(state, {schema: 'billing', table: 'orders', column: 'status'})?.note,
            ).toBe('4 = captured');
        });
    });

    describe('describeTarget', () => {
        it('joins every known level', () => {
            expect(describeTarget({database: 'db', schema: 's', table: 't', column: 'c'})).toBe(
                'db.s.t.c',
            );
            expect(describeTarget({table: 't'})).toBe('t');
        });
    });

    describe('groupNotesByDomain', () => {
        it('groups tables by domain in a deterministic order, ungrouped last', () => {
            const groups = groupNotesByDomain(state);
            expect(groups.map((group) => group.domain)).toEqual(['Audit', 'Billing', '']);
            expect(groups[1].tables.map((entry) => describeTarget(entry.target))).toEqual([
                'billing.orders',
                'billing.payments',
            ]);
            expect(groups[1].tables[0].columnCount).toBe(1);
            expect(groups[2].tables.map((entry) => describeTarget(entry.target))).toEqual([
                'logs',
                'shop.orders',
            ]);
        });

        it('returns nothing for no notes', () => {
            expect(groupNotesByDomain({...state, notes: []})).toEqual([]);
        });
    });

    describe('columnsWithNotes', () => {
        it('keeps database order and appends documented columns that no longer exist', () => {
            expect(
                columnsWithNotes(state, {schema: 'shop', table: 'orders'}, ['id', 'total']),
            ).toEqual([
                {name: 'id', found: true},
                {name: 'total', found: true},
                {name: 'gone', found: false},
            ]);
        });

        it('does not mix in columns of a same-named table in another schema', () => {
            expect(
                columnsWithNotes(state, {schema: 'billing', table: 'orders'}, ['status']),
            ).toEqual([{name: 'status', found: true}]);
        });

        it('shows documented columns when metadata is unavailable', () => {
            expect(columnsWithNotes(state, {table: 'logs'}, [])).toEqual([
                {name: 'level', found: false},
            ]);
        });
    });

    describe('schemaNotesFileName', () => {
        it('produces a safe file name', () => {
            expect(schemaNotesFileName('Prod / EU: shop')).toBe(
                'Prod_EU_shop.tabularis-notes.json',
            );
            expect(schemaNotesFileName('../..')).toBe('connection.tabularis-notes.json');
            expect(schemaNotesFileName('')).toBe('connection.tabularis-notes.json');
        });
    });
});
