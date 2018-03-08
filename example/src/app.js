const express = require('express');
const graphqlHTTP = require('express-graphql');

const knex = require('knex')({
  client: 'mysql',
  connection: {
    host: '127.0.0.1',
    user: 'root',
    password: 'secret',
    database: 'example'
  },
  pool: { min: 0, max: 7 }
});

const archen = require('archen')('data/schema.json');

const app = express();

app.get('/', (req, res) => res.send('Hello World!'));

app.use(
  '/graphql',
  graphqlHTTP(async (request, response, params) => ({
    schema: archen.getSchema(),
    context: archen.getContext(knex),
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
