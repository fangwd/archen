const fs = require('fs');

require('dotenv').config();

import {
  Connection,
  createConnection,
  createConnectionPool,
  ConnectionPool,
  Schema,
  Database
} from 'sqlit';

const DB_NAME = process.env.DB_NAME || 'archen_test';
const DB_TYPE = process.env.DB_TYPE || 'sqlite3';

const SCHEMA = fs.readFileSync('example/data/schema.sql').toString();
const DATA = fs.readFileSync('example/data/data.sql').toString();

// increase the default jasmine timeout interval (5s)
jasmine.DEFAULT_TIMEOUT_INTERVAL = 100000;

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
  const sqlite3 = require('sqlite3');
  const filename = `${DB_NAME}_${name}.db`;
  return new sqlite3.Database(filename, sqlite3.OPEN_READWRITE);
}

function createMySQLDatabase(name: string, data = true): Promise<any> {
  const mysql = require('mysql');
  const database = `${DB_NAME}_${name}`;

  const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS
  });

  const sql = SCHEMA + (data ? DATA : '');

  const lines = [
    `drop database if exists ${database}`,
    `create database ${database}`,
    `use ${database}`
  ].concat(sql.split(';').filter(line => line.trim()));

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

function createMySQLConnection(name: string): Connection {
  const database = `${DB_NAME}_${name}`;
  return createConnection('mysql', {
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

export function createDatabase(name: string, data = true): Promise<any> {
  return DB_TYPE === 'mysql'
    ? createMySQLDatabase(name, data)
    : createSQLite3Database(name);
}

export function dropDatabase(name: string): Promise<any> {
  return DB_TYPE === 'mysql'
    ? dropMySQLDatabase(name)
    : dropSQLite3Database(name);
}

export function createTestConnection(name: string): Connection {
  return DB_TYPE === 'mysql'
    ? createMySQLConnection(name)
    : createSQLite3Connection(name);
}

export function createTestConnectionPool(name: string): ConnectionPool {
  const database = `${DB_NAME}_${name}`;
  return createConnectionPool('mysql', {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: database,
    timezone: 'Z',
    connectionLimit: 10
  });
}

export function connectToDatabase(name: string, schema?: Schema): Database {
  if (!schema) {
    schema = new Schema(getExampleData());
  }
  // TODO: add support for sqlite3
  const pool = createTestConnectionPool(name);
  return new Database(pool, schema);
}

export function getId(length: number = 8) {
  return Math.random()
    .toString(36)
    .substring(length);
}

export function createOrderShippingEvents(db: Database) {
  const users = ['alice', 'bob', 'charlie', 'david', 'eve'].map(name =>
    db.table('user').append({ email: name, firstName: name })
  );

  const products = ['apple', 'banana', 'carrot'].map(name =>
    db.table('product').append({ name, sku: name })
  );

  for (const user of users) {
    for (let i = 0; i < 5; i++) {
      const order = db.table('order').append({
        user,
        dateCreated: new Date(2018, 0, i + 1),
        code: `${user.email}-${i + 1}`,
        status: i
      });

      products.forEach((product, index) => {
        const item = db.table('order_item').append({
          order,
          product,
          quantity: 3 - index
        });
      });

      const shipping = db
        .table('order_shipping')
        .append({ order, status: 5 - i });

      for (let j = 0; j < 5; j++) {
        db.table('order_shipping_event').append({
          orderShipping: shipping,
          eventTime: new Date(2018, 0, j + 1),
          eventDescription: `Event for order ${user.email}-${i + 1} #(${j + 1})`
        });
      }
    }
  }

  const dates = [1, 2, 3, 4, 5].map(day => new Date(2018, 1, day));

  return db.flush();
}
