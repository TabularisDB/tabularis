import {describe, it, expect} from 'vitest';
import type {Node, Edge} from '@xyflow/react';
import {
    describeMarkdownScope,
    escapeMarkdownInline,
    generateDbml,
    generateMarkdownSchema,
    generateMermaidErDiagram,
    sanitizeMermaidId,
} from '@/utils/schemaExport';

const node = (
    id: string,
    columns: Array<{
        name: string;
        type?: string;
        isPk?: boolean;
        isFk?: boolean;
    }>,
): Node =>
    ({
        id,
        type: 'schemaTable',
        position: {x: 0, y: 0},
        data: {label: id, columns},
    }) as Node;

const edge = (source: string, target: string, sourceHandle: string, targetHandle: string): Edge =>
    ({
        id: `e-${source}-${sourceHandle}-${target}-${targetHandle}`,
        source,
        target,
        sourceHandle,
        targetHandle,
    }) as Edge;

describe('sanitizeMermaidId', () => {
    it('replaces characters Mermaid cannot parse in identifiers', () => {
        expect(sanitizeMermaidId('order details')).toBe('order_details');
        expect(sanitizeMermaidId('public.users')).toBe('public_users');
    });

    it('prefixes identifiers starting with a digit', () => {
        expect(sanitizeMermaidId('2fa_tokens')).toBe('t_2fa_tokens');
    });
});

describe('generateMermaidErDiagram', () => {
    it('emits a table block with typed columns and key markers', () => {
        const result = generateMermaidErDiagram(
            [
                node('users', [
                    {name: 'id', type: 'int', isPk: true},
                    {name: 'email', type: 'varchar'},
                ]),
            ],
            [],
        );

        expect(result).toBe(
            [
                'erDiagram',
                '    users {',
                '        int id PK',
                '        varchar email',
                '    }',
                '',
            ].join('\n'),
        );
    });

    it('marks a column that is both primary and foreign key', () => {
        const result = generateMermaidErDiagram(
            [node('profiles', [{name: 'user_id', type: 'int', isPk: true, isFk: true}])],
            [],
        );

        expect(result).toContain('int user_id PK,FK');
    });

    it('points the relationship from the referenced table to the child table', () => {
        const result = generateMermaidErDiagram(
            [
                node('users', [{name: 'id', type: 'int', isPk: true}]),
                node('orders', [{name: 'user_id', type: 'int', isFk: true}]),
            ],
            [edge('orders', 'users', 'user_id', 'id')],
        );

        expect(result).toContain('    users ||--o{ orders : "user_id"');
    });

    it('does not repeat a relationship when the same edge appears twice', () => {
        const result = generateMermaidErDiagram(
            [node('users', []), node('orders', [])],
            [edge('orders', 'users', 'user_id', 'id'), edge('orders', 'users', 'user_id', 'id')],
        );

        const occurrences = result.split('\n').filter((line) => line.includes('||--o{')).length;
        expect(occurrences).toBe(1);
    });

    it('falls back to a placeholder type when the column type is missing', () => {
        const result = generateMermaidErDiagram([node('logs', [{name: 'payload'}])], []);

        expect(result).toContain('unknown payload');
    });

    it('emits an empty block for a table without columns', () => {
        const result = generateMermaidErDiagram([node('empty_table', [])], []);

        expect(result).toBe(['erDiagram', '    empty_table {', '    }', ''].join('\n'));
    });
});

describe('generateDbml', () => {
    it('marks a single primary key inline', () => {
        const result = generateDbml(
            [
                node('users', [
                    {name: 'id', type: 'int', isPk: true},
                    {name: 'email', type: 'varchar'},
                ]),
            ],
            [],
        );

        expect(result).toContain('Table users {');
        expect(result).toContain('  id int [pk]');
        expect(result).toContain('  email varchar');
    });

    it('uses an Indexes block for a composite primary key', () => {
        const result = generateDbml(
            [
                node('lignes_commande', [
                    {name: 'commande_id', type: 'int', isPk: true},
                    {name: 'produit_id', type: 'int', isPk: true},
                    {name: 'quantite', type: 'int'},
                ]),
            ],
            [],
        );

        // Inline [pk] cannot express a composite key, so it must not appear.
        expect(result).not.toContain('[pk]\n  produit_id');
        expect(result).toContain('  Indexes {');
        expect(result).toContain('    (commande_id, produit_id) [pk]');
    });

    it('keeps both endpoints of a foreign key', () => {
        const result = generateDbml(
            [node('orders', []), node('users', [])],
            [edge('orders', 'users', 'user_id', 'id')],
        );

        expect(result).toContain('Ref: orders.user_id > users.id');
    });

    it('emits one ref per distinct foreign key', () => {
        const result = generateDbml(
            [node('lignes', []), node('commandes', []), node('produits', [])],
            [
                edge('lignes', 'commandes', 'commande_id', 'id'),
                edge('lignes', 'produits', 'produit_id', 'id'),
                edge('lignes', 'commandes', 'commande_id', 'id'),
            ],
        );

        const refs = result.split('\n').filter((l) => l.startsWith('Ref:'));
        expect(refs).toEqual([
            'Ref: lignes.commande_id > commandes.id',
            'Ref: lignes.produit_id > produits.id',
        ]);
    });

    it('quotes identifiers that are not plain words', () => {
        const result = generateDbml(
            [node('order details', [{name: 'unit price', type: 'decimal'}])],
            [],
        );

        expect(result).toContain('Table "order details" {');
        expect(result).toContain('  "unit price" decimal');
    });

    it('falls back to a placeholder type when the column type is missing', () => {
        const result = generateDbml([node('logs', [{name: 'payload'}])], []);

        expect(result).toContain('  payload unknown');
    });
});

describe('escapeMarkdownInline', () => {
    it('escapes table delimiters and backticks', () => {
        expect(escapeMarkdownInline('a|b')).toBe('a\\|b');
        expect(escapeMarkdownInline('`code`')).toBe('\\`code\\`');
    });

    it('encodes HTML-sensitive characters', () => {
        expect(escapeMarkdownInline('<img src=x onerror=alert(1)>')).toBe(
            '&lt;img src=x onerror=alert(1)&gt;',
        );
        expect(escapeMarkdownInline('a & b')).toBe('a &amp; b');
    });

    it('turns every kind of line break into a space', () => {
        expect(escapeMarkdownInline('a\nb\r\nc\rd')).toBe('a b c d');
    });

    it('escapes inline syntax characters', () => {
        expect(escapeMarkdownInline('*x* [y] ~z~ #w \\')).toBe('\\*x\\* \\[y\\] \\~z\\~ \\#w \\\\');
    });

    it('keeps underscores inside a word but escapes ones that could start emphasis', () => {
        expect(escapeMarkdownInline('user_id')).toBe('user_id');
        expect(escapeMarkdownInline('_private_')).toBe('\\_private\\_');
    });
});

describe('describeMarkdownScope', () => {
    it('keeps schema and database names as they are', () => {
        expect(describeMarkdownScope('public')).toBe('public');
        expect(describeMarkdownScope('app_db.public')).toBe('app_db.public');
        expect(describeMarkdownScope('  sales  ')).toBe('sales');
    });

    it('reduces an absolute file path to its file name', () => {
        expect(describeMarkdownScope('D:\\data\\projects\\app.db')).toBe('app.db');
        expect(describeMarkdownScope('C:/Users/me/app.sqlite')).toBe('app.sqlite');
        expect(describeMarkdownScope('/home/me/data/app.db')).toBe('app.db');
        expect(describeMarkdownScope('\\\\server\\share\\app.db')).toBe('app.db');
    });

    it('returns undefined when there is no usable scope', () => {
        expect(describeMarkdownScope(undefined)).toBeUndefined();
        expect(describeMarkdownScope('   ')).toBeUndefined();
        expect(describeMarkdownScope('/')).toBeUndefined();
    });
});

describe('generateMarkdownSchema', () => {
    it('does not leak the local directory of a file-based database', () => {
        const result = generateMarkdownSchema([node('users', [])], [], {
            scope: 'D:\\work\\secret-client\\app.db',
        });

        expect(result).toContain('Scope: app.db\n');
        expect(result).not.toContain('secret-client');
    });

    it('writes a header, a column table per table and the relationships', () => {
        const result = generateMarkdownSchema(
            [
                node('users', [
                    {name: 'id', type: 'int', isPk: true},
                    {name: 'email', type: 'varchar(255)'},
                ]),
                node('orders', [
                    {name: 'id', type: 'int', isPk: true},
                    {name: 'user_id', type: 'int', isFk: true},
                ]),
            ],
            [edge('orders', 'users', 'user_id', 'id')],
            {scope: 'public'},
        );

        expect(result).toBe(
            [
                '# Schema reference',
                '',
                'Scope: public',
                '',
                'Covers the 2 tables loaded in the ER diagram. It lists only the names, types, keys and relationships the diagram knows about; it is not complete database documentation.',
                '',
                '## Tables',
                '',
                '### orders',
                '',
                '| Column | Type | Key |',
                '| --- | --- | --- |',
                '| id | int | PK |',
                '| user_id | int | FK |',
                '',
                '### users',
                '',
                '| Column | Type | Key |',
                '| --- | --- | --- |',
                '| id | int | PK |',
                '| email | varchar(255) |  |',
                '',
                '## Relationships',
                '',
                '| From table | From column | To table | To column |',
                '| --- | --- | --- | --- |',
                '| orders | user_id | users | id |',
                '',
            ].join('\n'),
        );
    });

    it('omits the scope line when no scope is known', () => {
        const result = generateMarkdownSchema([node('users', [])], []);

        expect(result).not.toContain('Scope:');
        expect(result).toContain('Covers the 1 table loaded in the ER diagram.');
    });

    it('handles an empty diagram', () => {
        const result = generateMarkdownSchema([], []);

        expect(result).toContain('Covers the 0 tables loaded in the ER diagram.');
        expect(result).toContain('_No tables are loaded in the diagram._');
        expect(result).toContain('_No relationships between the loaded tables._');
    });

    it('marks missing metadata as unknown instead of guessing', () => {
        const result = generateMarkdownSchema(
            [
                node('logs', [{name: 'payload'}, {name: 'level', type: '  '}]),
                node('empty_table', []),
            ],
            [{id: 'e1', source: 'logs', target: 'empty_table'} as Edge],
        );

        expect(result).toContain('| payload | _unknown_ |  |');
        expect(result).toContain('| level | _unknown_ |  |');
        expect(result).toContain('### empty_table\n\n_No columns are loaded for this table._');
        expect(result).toContain('| logs | _unknown_ | empty_table | _unknown_ |');
    });

    it('marks a column that is both primary and foreign key', () => {
        const result = generateMarkdownSchema(
            [node('profiles', [{name: 'user_id', type: 'int', isPk: true, isFk: true}])],
            [],
        );

        expect(result).toContain('| user_id | int | PK, FK |');
    });

    it('escapes hostile names in headings, cells and relationships', () => {
        const result = generateMarkdownSchema(
            [node('a|b', [{name: 'line\nbreak', type: '<script>`x`</script>'}]), node('c', [])],
            [edge('a|b', 'c', 'line\nbreak', 'id')],
        );

        expect(result).toContain('### a\\|b');
        expect(result).toContain('| line break | &lt;script&gt;\\`x\\`&lt;/script&gt; |  |');
        expect(result).toContain('| a\\|b | line break | c | id |');
        expect(result).not.toContain('<script>');
    });

    it('keeps every column pair of a composite foreign key in column order', () => {
        const result = generateMarkdownSchema(
            [
                node('order_lines', [
                    {name: 'line_no', type: 'int', isPk: true},
                    {name: 'order_id', type: 'int', isFk: true},
                    {name: 'order_region', type: 'text', isFk: true},
                ]),
                node('orders', [
                    {name: 'id', type: 'int', isPk: true},
                    {name: 'region', type: 'text', isPk: true},
                ]),
            ],
            [
                // Edges arrive in arbitrary order and may repeat.
                edge('order_lines', 'orders', 'order_region', 'region'),
                edge('order_lines', 'orders', 'order_id', 'id'),
                edge('order_lines', 'orders', 'order_region', 'region'),
            ],
        );

        const rows = result.split('\n').filter((line) => line.startsWith('| order_lines |'));
        expect(rows).toEqual([
            '| order_lines | order_id | orders | id |',
            '| order_lines | order_region | orders | region |',
        ]);
    });

    it('orders tables by identity regardless of input order and keeps column order', () => {
        const columns = [
            {name: 'zeta', type: 'int'},
            {name: 'alpha', type: 'int'},
        ];
        const nodes = [
            node('sales.orders', columns),
            node('Accounts', []),
            node('hr.orders', []),
            node('accounts', []),
        ];

        const forward = generateMarkdownSchema(nodes, []);
        const reversed = generateMarkdownSchema([...nodes].reverse(), []);

        expect(forward).toBe(reversed);
        const headings = forward.split('\n').filter((line) => line.startsWith('### '));
        expect(headings).toEqual([
            '### Accounts',
            '### accounts',
            '### hr.orders',
            '### sales.orders',
        ]);
        expect(forward.indexOf('| zeta |')).toBeLessThan(forward.indexOf('| alpha |'));
    });

    it('keeps tables that share a display label apart by their identity', () => {
        const withLabel = (id: string, label: string): Node =>
            ({...node(id, []), data: {label, columns: []}}) as Node;

        const result = generateMarkdownSchema(
            [withLabel('sales.orders', 'orders'), withLabel('hr.orders', 'orders')],
            [],
        );

        expect(result).toContain('### hr.orders');
        expect(result).toContain('### sales.orders');
        expect(result).toContain('Covers the 2 tables');
    });

    it('orders relationships deterministically', () => {
        const nodes = [node('a', []), node('b', []), node('c', [])];
        const edges = [edge('c', 'a', 'a_id', 'id'), edge('a', 'b', 'b_id', 'id')];

        const forward = generateMarkdownSchema(nodes, edges);
        const reversed = generateMarkdownSchema(nodes, [...edges].reverse());

        expect(forward).toBe(reversed);
        expect(forward.indexOf('| a | b_id | b | id |')).toBeLessThan(
            forward.indexOf('| c | a_id | a | id |'),
        );
    });
});
