const fs = require('fs');

require('dotenv').config();

import { Connection } from '../src/connection';

const DB_NAME = process.env.DB_NAME || 'archen_test';
const DB_TYPE = process.env.DB_TYPE || 'sqlite3';

const SCHEMA = fs.readFileSync('example/data/schema.sql').toString();
const DATA = fs.readFileSync('example/data/data.sql').toString();

function createSQLite3Database(name): Promise<void> {
  const sqlite3 = require('sqlite3');
  const filename = `${DB_NAME}_${name}.db`;
  return new Promise(resolve => {
    function _create() {
      const db = new sqlite3.Database(filename);
      db.serialize(function() {
        (SCHEMA + DATA).split(';').forEach(line => {
          const stmt = line.replace(/auto_increment|--.*?(\n|$)/gi, '\n');
          if (stmt.trim()) {
            db.run(stmt);
          }
        });
      });
      db.close(err => {
        if (err) throw err;
        _resolve();
      });
    }

    function _resolve() {
      resolve();
    }

    fs.exists(filename, exists => {
      if (exists) {
        fs.unlink(filename, err => {
          if (err) throw err;
          _create();
        });
      } else {
        _create();
      }
    });
  });
}

function dropSQLite3Database(name): Promise<void> {
  const filename = `${DB_NAME}_${name}.db`;
  return new Promise(resolve => {
    fs.exists(filename, exists => {
      if (exists) {
        fs.unlink(filename, err => {
          if (err) throw err;
          resolve();
        });
      }
    });
  });
}

function createSQLite3Connection(name: string): Connection {
  const filename = `${DB_NAME}_${name}.db`;
  return new Connection('sqlite3', {
    filename
  });
}

function createMySQLDatabase(name: string): Promise<any> {
  const mysql = require('mysql');
  const database = `${DB_NAME}_${name}`;

  const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS
  });

  const lines = [
    `drop database if exists ${database}`,
    `create database ${database}`,
    `use ${database}`
  ].concat((SCHEMA + DATA).split(';').filter(line => line.trim()));

  return serialise(line => {
    return new Promise((resolve, reject) => {
      db.query(line, (error, results, fields) => {
        if (error) reject(Error(error));
        resolve();
      });
    });
  }, lines);
}

function dropMySQLDatabase(name: string): Promise<void> {
  const mysql = require('mysql');
  const database = `${DB_NAME}_${name}`;

  const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS
  });

  return new Promise(resolve => {
    db.query(`drop database if exists ${database}`, err => {
      if (err) throw err;
      resolve();
    });
  });
}

function createMySQLConnection(name: string) {
  const database = `${DB_NAME}_${name}`;

  return new Connection('mysql', {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: database,
    timezone: 'Z',
    connectionLimit: 10
  });
}

function serialise(func, argv: any[]) {
  return new Promise(resolve => {
    const results = [];
    let next = 0;
    function _resolve() {
      if (next >= argv.length) {
        resolve(results);
      } else {
        const args = argv[next++];
        func(args).then(result => {
          results.push(result);
          _resolve();
        });
      }
    }
    _resolve();
  });
}

export function getExampleData() {
  const fileName = require('path').join(
    __dirname,
    '..',
    'example',
    'data',
    'schema.json'
  );
  return JSON.parse(fs.readFileSync(fileName).toString());
}

export function createDatabase(name: string): Promise<any> {
  return process.env.DB_TYPE === 'mysql'
    ? createMySQLDatabase(name)
    : createSQLite3Database(name);
}

export function dropDatabase(name: string): Promise<any> {
  return process.env.DB_TYPE === 'mysql'
    ? dropMySQLDatabase(name)
    : dropSQLite3Database(name);
}

export function createConnection(name: string): Connection {
  return process.env.DB_TYPE === 'mysql'
    ? createMySQLConnection(name)
    : createSQLite3Connection(name);
}
