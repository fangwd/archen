#!/usr/bin/env node

const { Archen } = require('../dist');
const getopt = require('sqlex/lib/getopt');
const fs = require('fs');

const options = getopt(
  [
    ['  ', '--config'],
    ['  ', '--dialect'],
    ['-h', '--host'],
    ['-u', '--user'],
    ['-p', '--password'],
    ['  ', '--port'],
    ['  ', '--database'],
    ['  ', '--schemaInfo'],
    ['  ', '--listen'],
    ['  ', '--exportGraphqlSchema'],
    ['  ', '--urlPath']
  ],
  {
    dialect: 'mysql',
    host: 'localhost',
    user: 'root',
    password: 'secret',
    database: 'example'
  }
);

async function main() {
  const config = getArchenConfig(options);
  const archen = new Archen(config);

  await archen.bootstrap();

  if (options.listen) {
    startGraphqlServer(archen, options);
  } else if (options.exportGraphqlSchema) {
    require('fs').writeFileSync(
      options.exportGraphqlSchema,
      require('graphql').printSchema(archen.graphql.getSchema())
    );
    process.exit();
  }
}

function startGraphqlServer(archen, options) {
  const express = require('express');
  const { graphqlHTTP } = require('express-graphql');

  const app = express();

  app.get('/', (req, res) => res.send('Hello World!'));

  app.use(function(req, res, next) {
    req.loader = archen.accessor;
    next();
  });

  app.use(
    options.urlPath || '/graphql',
    graphqlHTTP((request, response, params) => ({
      schema: archen.graphql.getSchema(),
      rootValue: archen.graphql.getRootValue(),
      pretty: false,
      graphiql: true,
      customFormatErrorFn: error => ({
        message: error.message,
        locations: error.locations,
        stack: error.stack ? error.stack.split('\n') : [],
        path: error.path
      })
    }))
  );

  app.listen(options.listen);
}

function getArchenConfig(options) {
  let schemaInfo;
  if (options.schemaInfo) {
    schemaInfo = JSON.parse(fs.readFileSync(options.schemaInfo).toString());
  }
  return options.config
    ? require(require('path').resolve(process.cwd(), options.config))
    : {
        database: {
          connection: {
            dialect: options.dialect,
            connection: {
              host: options.host,
              user: options.user,
              port: options.port,
              password: options.password,
              database: options.database,
              timezone: 'Z',
              connectionLimit: 2
            }
          },
          schemaInfo,
        },
        graphql: {
          getAccessor: context => context.loader
        }
      };
}

main();
