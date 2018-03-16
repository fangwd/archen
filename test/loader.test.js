const fs = require('fs');
const unit = require('./unit');
const helper = require('./helper');

beforeAll(() => {
  const createDatabase = process.env.ARCHEN_TEST
    ? helper.createMySQLDatabase
    : helper.createSQLite3Database;
  return createDatabase();
});

const archen = require('..')(fs.readFileSync('example/data/schema.json'));

test('creating simple object', done => unit.createSimpleObject(archen, done));
test('simple query', done => unit.simpleQuery(archen, done));
