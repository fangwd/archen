const express = require('express');
const graphqlHTTP = require('express-graphql');

const { Archen } = require('archen');

const options = {
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
  },
  schema: {
    models: [
      {
        table: 'product_category',
        fields: [
          {
            column: 'category_id',
            throughField: 'product_id'
          },
          {
            column: 'product_id',
            throughField: 'category_id',
            relatedName: 'categorySet'
          }
        ]
      },
      {
        table: 'user_group',
        fields: [
          {
            column: 'user_id',
            throughField: 'group_id'
          }
        ]
      }
    ]
  },
  graphql: {
    getAccessor: context => context.loader
  }
};

const archen = new Archen(options);

const app = express();

app.get('/', (req, res) => res.send('Hello World!'));

app.use(
  '/graphql',
  graphqlHTTP((request, response, params) => ({
    schema: archen.graphql.getSchema(),
    rootValue: archen.graphql.getRootValue(),
    context: { loader: archen.getAccessor() },
    pretty: false,
    graphiql: true,
    formatError: error => ({
      message: error.message,
      locations: error.locations,
      stack: error.stack ? error.stack.split('\n') : [],
      path: error.path
    })
  }))
);

archen.getSchemaInfo().then(() => {
  app.listen(3000);
});
