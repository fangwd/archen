import { Query } from 'mysql';

export type TransactionCallback = (
  connection: Connection | any
) => Promise<any>;

export interface Escape {
  escape: (unsafe: string) => string;
  escapeId: (unsafe: string) => string;
}

export type Row = {
  [key: string]: any;
};

export class QueryCounter {
  total: number = 0;
}

export interface Connection extends Escape {
  type: string;
  query(sql: string): Promise<any>;
  transaction(callback: TransactionCallback): Promise<any>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  escape(s: string): string;
  escapeId(name: string): string;
  queryCounter: QueryCounter;
}
