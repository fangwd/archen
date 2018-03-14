const fs = require('fs');
const { graphql } = require('graphql');
const { createDatabase } = require('./helper');

let db;

beforeAll(() => {
  return createDatabase().then(knex => {
    db = knex;
  });
});

const archen = require('..')(fs.readFileSync('example/data/schema.json'));

test('creating object', done => {
  expect.assertions(6);

  const EMAIL = 'user@example.com';
  const STATUS = 200;

  const QUERY = `mutation {
  createUser(data: {email: "${EMAIL}", status: ${STATUS}}) {
    id
    email
    status
  }
}
`;
  graphql(archen.getSchema(), QUERY, null, archen.getContext(db)).then(row => {
    const user = row.data.createUser;
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

test('simple query', done => {
  expect.assertions(3);

  const QUERY = `
  {
    categories(where: {parent: {name: "Fruit"}}, orderBy: "name") {
      name
    }
  }
`;
  graphql(archen.getSchema(), QUERY, null, archen.getContext(db)).then(
    result => {
      const rows = result.data.categories;
      expect(rows.length).toBe(2);
      expect(rows[0].name).toBe('Apple');
      expect(rows[1].name).toBe('Banana');
      done();
    }
  );
});
