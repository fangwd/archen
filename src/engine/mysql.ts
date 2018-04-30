import { Connection, TransactionCallback, QueryCounter } from './connection';

import mysql = require('mysql');

class MySQL implements Connection {
  type: string = 'mysql';
  queryCounter: QueryCounter = new QueryCounter();

  private connection: mysql.Connection;

  constructor(options) {
    this.connection = mysql.createConnection(options);
  }

  query(sql: string): Promise<any[] | void> {
    console.log('--', sql);
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
      this.connection.beginTransaction(error => {
        if (error) return reject(error);
        let promise;
        try {
          promise = callback(this);
        } catch (error) {
          return this.connection.rollback(function() {
            reject(error);
          });
        }
        if (promise instanceof Promise) {
          promise
            .then(result => {
              this.connection.commit(function(error) {
                if (error) {
                  this.conn.rollback(function() {
                    reject(error);
                  });
                } else {
                  resolve(result);
                }
              });
            })
            .catch(reason => {
              this.connection.rollback(function() {
                reject(reason);
              });
            });
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
      this.connection.end(function(err) {
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

export default function createConnection(options): Connection {
  return new MySQL(options);
}
