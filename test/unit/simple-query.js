const helper = require('../helper');

const QUERY = `
{
  categories(where: {parent: {name: "Fruit"}}, orderBy: "name") {
    name
  }
}
`;

module.exports = function(archen, done) {
  expect.assertions(3);

  const db = helper.createConnection();

  helper
    .graphql(archen.getSchema(), QUERY, null, archen.getContext(db))
    .then(result => {
      const rows = result.data.categories;
      expect(rows.length).toBe(2);
      expect(rows[0].name).toBe('Apple');
      expect(rows[1].name).toBe('Banana');
      done();
    });
};
