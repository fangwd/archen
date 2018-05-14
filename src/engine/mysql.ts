import {
  Connection,
  TransactionCallback,
  QueryCounter,
  ConnectionPool
} from '.';

import mysql = require('mysql');

class _ConnectionPool extends ConnectionPool {
  private pool: any;

  constructor(options) {
    super();
    this.pool = mysql.createPool(options);
  }

  getConnection(): Promise<Connection> {
    return new Promise((resolve, reject) => {
      return this.pool.getConnection((error, connection) => {
        if (error) reject(Error(error));
        resolve(new _Connection(connection, true));
      });
    });
  }

  close(): Promise<any> {
    return new Promise((resolve, reject) => {
      return this.pool.end(error => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  escape(value: string): string {
    return mysql.escape(value);
  }

  escapeId(name: string) {
    return mysql.escapeId(name);
  }
}

class _Connection extends Connection {
  dialect: string = 'mysql';
  connection: any;
  queryCounter: QueryCounter = new QueryCounter();

  private pool: _ConnectionPool;

  constructor(options, connected?: boolean) {
    super();
    if (connected) {
      this.connection = options;
    } else {
      this.connection = mysql.createConnection(options);
    }
  }

  release() {
    this.connection.release();
  }

  query(sql: string): Promise<any[] | void> {
    this.queryCounter.total++;
    return new Promise((resolve, reject) => {
      this.connection.query(sql, (error, results, fields) => {
        if (error) {
          return reject(error);
        }
        if (Array.isArray(results)) {
          resolve(results);
        } else if (results.insertId) {
          resolve(results.insertId);
        } else {
          resolve(results.affectedRows);
        }
      });
    });
  }

  transaction(callback: TransactionCallback): Promise<any> {
    return new Promise((resolve, reject) => {
      return this.connection.beginTransaction(error => {
        if (error) return reject(error);
        let promise;
        try {
          promise = callback(this);
        } catch (error) {
          return this.connection.rollback(() => {
            reject(error);
          });
        }
        if (promise instanceof Promise) {
          return promise
            .then(result =>
              this.connection.commit(error => {
                if (error) {
                  return this.connection.rollback(() => {
                    reject(error);
                  });
                } else {
                  resolve(result);
                }
              })
            )
            .catch(reason =>
              this.connection.rollback(() => {
                reject(reason);
              })
            );
        } else {
          resolve();
        }
      });
    });
  }

  commit(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.connection.commit(error => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  rollback(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.connection.rollback(error => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  disconnect(): Promise<any> {
    return new Promise((resolve, reject) => {
      this.connection.end(err => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  escape(value: string): string {
    return mysql.escape(value);
  }

  escapeId(name: string) {
    return mysql.escapeId(name);
  }
}

export default {
  createConnectionPool: (options): ConnectionPool => {
    return new _ConnectionPool(options);
  },
  createConnection: (options): Connection => {
    return new _Connection(options);
  }
};
