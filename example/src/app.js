const express = require('express');
const graphqlHTTP = require('express-graphql');
const fs = require('fs');
const archen = require('../../dist');

const mysql = archen.createConnection('mysql', {
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

const inst = new archen.Instance(
  fs.readFileSync('example/data/schema.json'),
  options
);

const app = express();

app.get('/', (req, res) => res.send('Hello World!'));

app.use(
  '/graphql',
  graphqlHTTP((request, response, params) => ({
    schema: inst.getSchema(),
    context: inst.getContext(mysql),
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
