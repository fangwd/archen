const helper = require('../helper');

const EMAIL = 'user@example.com';
const STATUS = 200;

const QUERY = `
mutation {
  createUser(data: {email: "${EMAIL}", status: ${STATUS}}) {
    id
    email
    status
  }
}
`;

module.exports = function createSimpleObject(archen, done) {
  expect.assertions(6);

  const db = helper.createConnection();

  helper
    .graphql(archen.getSchema(), QUERY, null, archen.getContext(db))
    .then(row => {
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
};
