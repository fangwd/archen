const fs = require('fs');
const sqlite3 = require('sqlite3');

const DATABASE = 'example.db';
const SCHEMA = fs.readFileSync('example/data/schema.sql').toString();
const DATA = fs.readFileSync('example/data/data.sql').toString();

const archen = require('..')(fs.readFileSync('example/data/schema.json'));

function createDatabase(overwrite) {
  return new Promise(resolve => {
    function _create() {
      const db = new sqlite3.Database(DATABASE);
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
      const db = require('knex')({
        client: 'sqlite3',
        connection: {
          filename: DATABASE
        },
        useNullAsDefault: true
      });
      resolve(db);
    }

    fs.exists(DATABASE, exists => {
      if (exists) {
        fs.unlink(DATABASE, err => {
          if (err) throw err;
          _create();
        });
      } else {
        _create();
      }
    });
  });
}

module.exports = { createDatabase };
