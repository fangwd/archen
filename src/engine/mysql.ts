import { Connection, TransactionCallback } from './connection';

import mysql = require('mysql');

class MySQL extends Connection {
  private connection: mysql.Connection;

  constructor(options) {
    super();
    this.connection = mysql.createConnection(options);
  }

  query(sql: string): Promise<any[] | void> {
    return new Promise((resolve, reject) => {
      this.connection.query(sql, (error, results, fields) => {
        if (error) return reject(error);
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
        const promise = callback(this);
        if (promise instanceof Promise) {
          promise
            .then(() => {
              this.connection.commit(function(error) {
                if (error) {
                  this.conn.rollback(function() {
                    reject(error);
                  });
                } else {
                  resolve();
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
