import type {TableTarget} from './databaseObjects';
import type {ForeignKey, Index} from './schema';

export type SchemaObjectDetails = TableTarget & {name: string} & (
        {kind: 'index'; rows: Index[]} | {kind: 'foreign_key'; rows: ForeignKey[]}
    );
