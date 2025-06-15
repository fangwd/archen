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
    ['  ', '--exportGraphqlSchema'],
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

if (options.exportGraphqlSchema) {
    require('fs').writeFileSync(
      options.exportGraphqlSchema,
      require('graphql').printSchema(archen.graphql.getSchema())
    );
    process.exit();
  }
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
