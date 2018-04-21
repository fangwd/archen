#!/usr/bin/env node

const engine = require('../dist/engine');

const options = require('../lib/getopt')([
  ['-D', '--dialect', true],
  ['-u', '--username', true],
  ['-p', '--password', true],
  ['-o', '--output', true]
]);

if (options.argv.length === 0) {
  throw Error('Database name required.');
}

const connection = engine.createConnection(options.dialect, {
  user: options.username,
  password: options.password
});

engine.getInformationSchema(connection, options.argv[0]).then(schema => {
  schema = JSON.stringify(schema, null, 4);
  if (options.output) {
    require('fs').writeFileSync(options.output, schema);
  } else {
    console.log(schema);
  }
  connection.disconnect();
});
