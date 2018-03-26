import { Domain } from '../src/domain';
import { createOne, updateOne, upsertOne, deleteOne } from '../src/mutation';
import { rowToCamel } from '../src/common';
import helper = require('./helper');

beforeAll(() => {
  const createDatabase = process.env.ARCHEN_TEST
    ? helper.createMySQLDatabase
    : helper.createSQLite3Database;
  return createDatabase();
});

const domain = new Domain(helper.getExampleData());

function createSimpleObject(done) {
  expect.assertions(8);

  const model = domain.model('user');

  const data = {
    email: 'user-1@example.com',
    status: 200,
    firstName: 'Dude'
  };

  helper.createConnection().transaction(db =>
    createOne(db, model, data).then(user => {
      expect(user.email).toBe(data.email);
      expect(user.status).toBe(data.status);
      expect(user.firstName).toBe(data.firstName);
      return db
        .select('*')
        .from('user')
        .where({ email: data.email })
        .then(rows => {
          expect(rows.length).toBe(1);
          const row = rowToCamel(rows[0], model);
          expect(row.id).toBe(user.id);
          expect(row.email).toBe(user.email);
          expect(row.firstName).toBe(user.firstName);
          expect(row.status).toBe(user.status);
          done();
        });
    })
  );
}

function updateSimpleObject(done) {
  expect.assertions(9);

  const model = domain.model('user');

  const data = {
    email: 'user-2@example.com',
    status: 200,
    firstName: 'Dude'
  };

  helper.createConnection().transaction(db =>
    createOne(db, model, data).then(user =>
      updateOne(db, model, {
        data: { email: 'user-2x@example.com', firstName: 'Dude-x' },
        where: { email: data.email }
      }).then(user => {
        expect(user.email).toBe('user-2x@example.com');
        expect(user.status).toBe(data.status);
        expect(user.firstName).toBe('Dude-x');
        return db
          .select('*')
          .from('user')
          .where({ email: data.email })
          .then(rows => {
            expect(rows.length).toBe(0);
            return db
              .select('*')
              .from('user')
              .where({ email: 'user-2x@example.com' })
              .then(rows => {
                expect(rows.length).toBe(1);
                const row = rowToCamel(rows[0], model);
                expect(row.id).toBe(user.id);
                expect(row.email).toBe(user.email);
                expect(row.firstName).toBe(user.firstName);
                expect(row.status).toBe(user.status);
                done();
              });
          });
      })
    )
  );
}

function upsertSimpleObject(done) {
  expect.assertions(9);

  const model = domain.model('user');

  const data = {
    email: 'user-3@example.com',
    firstName: 'Dude'
  };

  helper.createConnection().transaction(db =>
    createOne(db, model, data).then(user => {
      const userId = user.id;
      return upsertOne(db, model, {
        create: { email: 'user-3@example.com' }
      }).then(user => {
        expect(user.id).toBe(userId);
        return upsertOne(db, model, {
          create: { email: 'user-3@example.com' },
          update: { email: 'user-3x@example.com', firstName: 'Dude-x' }
        })
          .then(user => {
            expect(user.id).toBe(userId);
            expect(user.email).toBe('user-3x@example.com');
            expect(user.firstName).toBe('Dude-x');
            return db
              .select('*')
              .from('user')
              .where({ email: data.email })
              .then(rows => {
                expect(rows.length).toBe(0);
                return db
                  .select('*')
                  .from('user')
                  .where({ email: 'user-3x@example.com' })
                  .then(rows => {
                    expect(rows.length).toBe(1);
                    const row = rowToCamel(rows[0], model);
                    expect(row.id).toBe(userId);
                    expect(row.email).toBe(user.email);
                    expect(row.firstName).toBe(user.firstName);
                    done();
                  });
              });
          })
          .catch(reason => {
            console.log(JSON.stringify(reason, null, 4));
            throw Error(reason);
          });
      });
    })
  );
}

function deleteObject(done) {
  expect.assertions(3);

  const model = domain.model('user');

  const data = {
    email: 'user-4@example.com'
  };

  helper.createConnection().transaction(db =>
    createOne(db, model, data).then(user => {
      const userId = user.id;
      return updateOne(db, model, {
        data: { email: 'user-4x@example.com' },
        where: { email: 'user-4@example.com' }
      }).then(user =>
        deleteOne(db, model, { where: { email: 'user-4xx@example.com' } }).then(
          user => {
            expect(user).toBe(null);
            return deleteOne(db, model, {
              where: { email: 'user-4x@example.com' }
            }).then(user => {
              expect(user.email).toBe('user-4x@example.com');
              return db
                .select('*')
                .from('user')
                .where({ email: 'user-4x@example.com' })
                .then(rows => {
                  expect(rows.length).toBe(0);
                  done();
                });
            });
          }
        )
      );
    })
  );
}

test('creating simple object', createSimpleObject);
test('updating simple object', updateSimpleObject);
test('upserting simple object', upsertSimpleObject);
test('deleting object', deleteObject);
test('creating object #1', createObject_1);
test('creating object #2', createObject_2);

function createObject_1(done) {
  expect.assertions(2);

  const model = domain.model('category');

  const data = {
    name: 'Drinks',
    parent: {
      connect: {
        id: 1
      }
    }
  };

  helper.createConnection().transaction(db =>
    createOne(db, model, data).then(row => {
      expect(row.parent.id).toBe(data.parent.connect.id);
      expect(row.name).toBe(data.name);
      done();
    })
  );
}

function createObject_2(done) {
  expect.assertions(4);

  const model = domain.model('category');

  const data = {
    name: 'Vegitable',
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
        {
          parent: {
            id: 2
          },
          name: 'Apple'
        },
        {
          parent: {
            id: 2
          },
          name: 'Banana'
        }
      ]
    }
  };

  helper.createConnection().transaction(db =>
    createOne(db, model, data).then(row => {
      const parentId = row.id;
      console.log(row);
      expect(row.parent.id).toBe(data.parent.connect.id);
      expect(row.name).toBe(data.name);
      return db
        .select('*')
        .from('category')
        .where({ name: 'Vegitable' })
        .orWhere({ parent_id: parentId })
        .then(rows => {
          console.log(rows);
          expect(rows.length).toBe(5);
          const cucumber = rows.find(row => row.name === 'Cucumber');
          expect(cucumber.parent_id).toBe(parentId);
          done();
        });
    })
  );
}
