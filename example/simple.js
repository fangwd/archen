const { graphql } = require('graphql');
const { Archen } = require('archen');

const archen = new Archen({
  database: {
    dialect: 'mysql',
    connection: {
      host: 'localhost',
      user: 'root',
      password: 'secret',
      database: 'example',
      timezone: 'Z',
      connectionLimit: 10
    }
  }
});

archen.getSchemaInfo().then(() => {
  const [schema, rootValue, accessor] = [
    archen.graphql.getSchema(),
    archen.graphql.getRootValue(),
    archen.getAccessor()
  ];

  const query = `
  {
    posts(orderBy: "dateCreated desc", limit: 10) {
      title
      comments {
        content
      }
    }
  }`;

  graphql(schema, query, rootValue, { accessor }).then(response => {
    console.log(response);
  });
});
