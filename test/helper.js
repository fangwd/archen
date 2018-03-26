const fs = require('fs');
const sqlite3 = require('sqlite3');
const knex = require('knex');

const TEST_DB = process.env.ARCHEN_TEST || 'archen_test';
const SCHEMA = fs.readFileSync('example/data/schema.sql').toString();
const DATA = fs.readFileSync('example/data/data.sql').toString();

//const archen = require('..')(fs.readFileSync('example/data/schema.json'));

function createSQLite3Connection() {
  return knex({
    client: 'sqlite3',
    connection: {
      filename: TEST_DB
    },
    useNullAsDefault: true
  });
}

function createSQLite3Database() {
  return new Promise(resolve => {
    function _create() {
      const db = new sqlite3.Database(TEST_DB);
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

    fs.exists(TEST_DB, exists => {
      if (exists) {
        fs.unlink(TEST_DB, err => {
          if (err) throw err;
          _create();
        });
      } else {
        _create();
      }
    });
  });
}

function createMySQLConnection(exists = true) {
  const db = knex({
    client: 'mysql',
    connection: {
      host: '127.0.0.1',
      user: 'root',
      password: 'secret',
      database: exists ? TEST_DB : undefined,
      timezone: 'Z'
    },
    pool: { min: 0, max: 7 }
  });
  return db;
}

function createMySQLDatabase() {
  return new Promise(resolve => {
    const db = createConnection(false);
    const lines = [
      `drop database if exists ${TEST_DB}`,
      `create database ${TEST_DB}`,
      `use ${TEST_DB}`
    ].concat((SCHEMA + DATA).split(';').filter(line => line.trim()));
    let next = 0;
    function _resolve() {
      if (next >= lines.length) {
        resolve();
      } else {
        const line = lines[next++];
        db.raw(line).then(() => {
          _resolve();
        });
      }
    }
    _resolve();
  });
}

function getExampleData() {
  const fileName = require('path').join(
    __dirname,
    '..',
    'example',
    'data',
    'schema.json'
  );
  return JSON.parse(fs.readFileSync(fileName).toString());
}

const createConnection = process.env.ARCHEN_TEST
  ? createMySQLConnection
  : createSQLite3Connection;

module.exports = {
  createSQLite3Database,
  createMySQLDatabase,
  createConnection,
  getExampleData,
  graphql: require('graphql').graphql
};
