const express = require('express');
const graphqlHTTP = require('express-graphql');
const fs = require('fs');
const engine = require('../../dist/engine');

const mysql = engine.createConnection('mysql', {
  host: 'localhost',
  user: 'root',
  password: 'secret',
  database: 'example',
  timezone: 'Z',
  connectionLimit: 10
});

const options = {
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
    }
  ]
};

const archen = new (require('../../dist')).Archen(
  fs.readFileSync('example/data/schema.json'),
  options
);

const app = express();

app.get('/', (req, res) => res.send('Hello World!'));

app.use(
  '/graphql',
  graphqlHTTP((request, response, params) => ({
    schema: archen.getSchema(),
    context: archen.getContext(mysql),
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

app.listen(3000);
