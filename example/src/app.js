const express = require('express');
const graphqlHTTP = require('express-graphql');
const fs = require('fs');

const knex = require('knex')({
  client: 'mysql',
  connection: {
    host: '127.0.0.1',
    user: 'root',
    password: 'secret',
    database: 'example',
    timezone: 'Z'
  },
  pool: { min: 0, max: 7 }
});

let archen;

if (process.env.NODE_ENV === 'development' || process.env.ARCHEN_TEST) {
  archen = require('../..')(fs.readFileSync('example/data/schema.json'));
} else {
  archen = require('archen')(fs.readFileSync('data/schema.json'));
}

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
