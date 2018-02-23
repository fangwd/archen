const express = require('express');
const graphqlHTTP = require('express-graphql');

import { createSchema, createLoader } from 'archen';

const app = express();

const knex = require('knex')({
  client: 'mysql',
  connection: {
    host: '127.0.0.1',
    user: 'root',
    password: 'secret',
    database: 'example',
  },
  pool: { min: 0, max: 7 },
});

const schemaFile = require('path').join(__dirname, 'schema.json');
const schemaData = JSON.parse(require('fs').readFileSync(schemaFile));

app.use(function(req, res, next) {
  req.loader = createLoader(knex, schemaData);
  next();
});

app.use(
  '/graphql',
  graphqlHTTP({
    schema: createSchema(schemaData),
    graphiql: true,
  })
);

app.listen(3000, () => console.log('Example server running on port 3000'));
