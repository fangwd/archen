export type TransactionCallback = (connection: Connection) => Promise<any>;

export interface Escape {
  escape: (unsafe: string) => string;
  escapeId: (unsafe: string) => string;
}

export type Row = {
  [key: string]: any;
};

export class Connection implements Escape {
  query(sql: string): Promise<any> {
    return Promise.resolve();
  }

  transaction(callback: TransactionCallback): Promise<any> {
    return Promise.reject(Error('Not implemented'));
  }

  commit(): Promise<void> {
    return Promise.reject(Error('Not implemented'));
  }

  rollback(): Promise<void> {
    return Promise.reject(Error('Not implemented'));
  }

  escape(s: string): string {
    return `'${s}'`;
  }

  escapeId(name: string): string {
    return name;
  }
}
