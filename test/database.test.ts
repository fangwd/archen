import { Schema, ForeignKeyField } from '../src/model';
import { Value } from '../src/database';
import helper = require('./helper');

const NAME = 'database';

beforeAll(() => helper.createDatabase(NAME));
//afterAll(() => helper.dropDatabase(NAME));

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

test('get success', done => {
  expect.assertions(1);

  const table = helper.connectToDatabase(NAME).table('user');
  table
    .get({
      email: 'alice@example.com',
      firstName: 'Alice'
    })
    .then(row => {
      const lastName = row.lastName;
      table.get(row.id as Value).then(row => {
        expect(row.lastName).toBe(lastName);
        done();
      });
    });
});

test('get fail', done => {
  expect.assertions(1);

  const table = helper.connectToDatabase(NAME).table('user');
  table
    .get({
      firstName: 'Alice'
    })
    .catch(reason => {
      expect(!!/Bad/i.test(reason)).toBe(true);
      done();
    });
});

test('create with connect', done => {
  expect.assertions(1);

  const ID = 1;

  const table = helper.connectToDatabase(NAME).table('order');
  table
    .create({
      user: { connect: { email: 'alice@example.com' } },
      code: `test-order-${ID}`
    })
    .then(order => {
      table.db
        .table('user')
        .get({ email: 'alice@example.com' })
        .then(user => {
          expect(order.user.id).toBe(user.id);
          done();
        });
    });
});

// upsert without update should create or return the existing row
test('upsert #1', done => {
  expect.assertions(1);

  const ID = 2;

  const table = helper.connectToDatabase(NAME).table('order');
  function _upsert() {
    return table
      .upsert({
        user: { connect: { email: 'alice@example.com' } },
        code: `test-order-${ID}`
      })
      .then(order => {
        table.db
          .table('user')
          .get({ email: 'alice@example.com' })
          .then(user => {
            expect(order.user.id).toBe(user.id);
            return user;
          });
      });
  }
  _upsert()
    .then(_upsert)
    .then(user => done());
});

test('upsert #2', done => {
  // expect.assertions(4);
  const ID = 3;

  const table = helper.connectToDatabase(NAME).table('order');

  function _upsert() {
    return table.upsert(
      {
        user: { connect: { email: 'alice@example.com' } },
        code: `test-order-${ID}`
      },
      {
        user: { create: { email: 'nobody@example.com' } },
        code: `test-order-${ID}x`
      }
    );
  }

  _upsert().then(order => {
    expect(order.code).toBe(`test-order-${ID}`);
    table.db
      .table('user')
      .get({ email: 'alice@example.com' })
      .then(user => {
        expect(order.user.id).toBe(user.id);
        _upsert().then(order => {
          expect(order.code).toBe(`test-order-${ID}x`);
          table.db
            .table('user')
            .get({ email: 'nobody@example.com' })
            .then(user => {
              expect(order.user.id).toBe(user.id);
              done();
            });
        });
      });
  });
});

test('update related #1', done => {
  expect.assertions(1);

  const data = {
    name: 'Vegetable',
    parent: {
      connect: {
        id: 1
      }
    },
    categories: {
      create: [
        {
          name: 'Cucumber'
        },
        {
          name: 'Tomato'
        }
      ],
      connect: [
        { parent: { id: 2 }, name: 'Apple' },
        { parent: { id: 2 }, name: 'Banana' }
      ]
    }
  };

  const table = helper.connectToDatabase(NAME).table('category');
  table.create(data).then(async id => {
    const row = await table.get(id);
    expect(row.name).toBe(data.name);
    done();
  });
});
