import { Schema } from '../src/model';
import helper = require('./helper');

const NAME = 'database';

beforeAll(() => helper.createDatabase(NAME));
afterAll(() => helper.dropDatabase(NAME));

test('select', done => {
  expect.assertions(2);

  const db = helper.connectToDatabase(NAME);
  const options = {
    where: {
      name_like: '%Apple'
    },
    orderBy: 'name',
    offset: 1,
    limit: 1
  };
  db
    .table('product')
    .select('*', options)
    .then(rows => {
      expect(rows.length).toBe(1);
      expect((rows[0].name as string).indexOf('Australian')).toBe(0);
      done();
    });
});

test('insert', done => {
  expect.assertions(2);

  const db = helper.connectToDatabase(NAME);
  db
    .table('category')
    .insert({ name: 'Frozen' })
    .then(id => {
      expect(id).toBeGreaterThan(0);
      db
        .table('category')
        .select('*', { where: { name: 'Frozen' } })
        .then(rows => {
          expect(rows.length).toBe(1);
          done();
        });
    });
});

test('update', done => {
  expect.assertions(3);

  const db = helper.connectToDatabase(NAME);
  db
    .table('category')
    .insert({ name: 'Ice' })
    .then(id => {
      expect(id).toBeGreaterThan(0);
      db
        .table('category')
        .update({ name: 'Ice Cream' }, { name: 'Ice' })
        .then(() => {
          db
            .table('category')
            .select('*', { where: { id } })
            .then(rows => {
              expect(rows.length).toBe(1);
              expect(rows[0].name).toBe('Ice Cream');
              done();
            });
        });
    });
});
