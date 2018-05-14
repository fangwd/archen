import { getInformationSchema } from './information_schema';

export interface ConnectionInfo {
  dialect: string;
  connection: any;
}

export type Value = string | number | boolean | Date | null;

export type Row = {
  [key: string]: Value;
};

export class QueryCounter {
  total: number = 0;
}

export type TransactionCallback = (
  connection: Connection
) => Promise<any> | void;

export interface Dialect {
  dialect: string;
  escape: (unsafe: string) => string;
  escapeId: (unsafe: string) => string;
}

export abstract class Connection implements Dialect {
  dialect: string;
  connection: any;
  queryCounter: QueryCounter;

  abstract query(sql: string): Promise<any>;
  abstract transaction(callback: TransactionCallback): Promise<any>;

  commit(): Promise<void> {
    return this.query('commit');
  }

  rollback(): Promise<void> {
    return this.query('rollback');
  }

  abstract disconnect(): Promise<any>;
  abstract release();

  abstract escape(s: string): string;
  abstract escapeId(name: string): string;
}

export abstract class ConnectionPool implements Dialect {
  dialect: string;

  abstract getConnection(): Promise<Connection>;
  abstract close(): Promise<any>;

  abstract escape(s: string): string;
  abstract escapeId(name: string): string;
}

export function createConnectionPool(
  dialect: string,
  connection: any
): ConnectionPool {
  if (dialect === 'mysql') {
    return require('./mysql').default.createConnectionPool(connection);
  }
  throw Error(`Unsupported engine type: ${dialect}`);
}

export function createConnection(dialect: string, connection: any): Connection {
  if (dialect === 'mysql') {
    return require('./mysql').default.createConnection(connection);
  }
  throw Error(`Unsupported engine type: ${dialect}`);
}

export { getInformationSchema };
