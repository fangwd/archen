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

const archen = new (require('../../dist')).Archen(
  fs.readFileSync('example/data/schema.json')
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
