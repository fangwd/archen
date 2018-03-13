const fs = require('fs');
const sqlite3 = require('sqlite3');
const { graphql } = require('graphql');

const DATABASE = 'myshop.db';
const SCHEMA = fs.readFileSync('example/data/schema.sql').toString();
const DATA = fs.readFileSync('example/data/data.sql').toString();

let db;

beforeAll(() => {
  return createDatabase().then(() => {
    db = require('knex')({
      client: 'sqlite3',
      connection: {
        filename: DATABASE
      },
      useNullAsDefault: true
    });
    return Promise.resolve();
  });
});

const archen = require('..')(fs.readFileSync('example/data/schema.json'));

test('creating object', done => {
  expect.assertions(6);

  const EMAIL = 'user@example.com';
  const STATUS = 200;

  const QUERY = `mutation {
  create_user(data: {email: "${EMAIL}", status: ${STATUS}}) {
    id
    email
    status
  }
}
`;
  graphql(archen.getSchema(), QUERY, null, archen.getContext(db)).then(row => {
    const user = row.data.create_user;
    expect(user.email).toBe(EMAIL);
    expect(user.status).toBe(STATUS);
    db
      .select('*')
      .from('user')
      .where({ email: EMAIL })
      .then((rows, fields) => {
        expect(rows.length).toBe(1);
        const row = rows[0];
        expect(row.id).toBe(user.id);
        expect(row.email).toBe(EMAIL);
        expect(row.status).toBe(STATUS);
        done();
      });
  });
});

function createDatabase() {
  return new Promise(resolve => {
    function _create() {
      const db = new sqlite3.Database(DATABASE);
      db.serialize(function() {
        (SCHEMA + DATA).split(';').forEach(line => {
          const stmt = line.replace(/auto_increment|--.*?(\n|$)/ig, '\n');
          if (stmt.trim()) {
            console.log(stmt)
            db.run(stmt);
          }
        });
      });
      db.close(err => {
        if (err) throw err;
        resolve();
      });
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
