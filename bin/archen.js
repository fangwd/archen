#!/usr/bin/env node

const { Archen } = require('../dist');
const getopt = require('sqlit/lib/getopt');

const options = getopt(
  [
    ['  ', '--dialect'],
    ['-h', '--host'],
    ['-u', '--user'],
    ['-p', '--password'],
    ['  ', '--database'],
    ['  ', '--listen'],
    ['  ', '--export-graphql-schema']
  ],
  {
    dialect: 'mysql',
    host: 'localhost',
    user: 'root',
    password: 'secret',
    database: 'example',
    listen: 3000
  }
);

if (options.listen) {
  const express = require('express');
  const graphqlHTTP = require('express-graphql');

  const config = {
    database: {
      dialect: options.dialect,
      connection: {
        host: options.host,
        user: options.user,
        password: options.password,
        database: options.database,
        timezone: 'Z',
        connectionLimit: 2
      }
    },
    graphql: {
      getAccessor: context => context.loader
    }
  };

  const archen = new Archen(config);
  const app = express();

  app.get('/', (req, res) => res.send('Hello World!'));

  app.use(function(req, res, next) {
    req.loader = archen.getAccessor();
    next();
  });

  app.use(
    '/graphql',

    graphqlHTTP((request, response, params) => ({
      schema: archen.graphql.getSchema(),
      rootValue: archen.graphql.getRootValue(),
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
    app.listen(options.listen);
    if (options.exportGraphqlSchema) {
      require('fs').writeFileSync(
        options.exportGraphqlSchema,
        require('graphql').printSchema(archen.graphql.getSchema())
      );
    }
  });
}
