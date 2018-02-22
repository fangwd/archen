const { Database } = require('./lib/database');
const { Loader } = require('./lib/loader');
const { Builder } = require('./lib/builder');

function createSchema(data, options) {
  const builder = new Builder(new Database(data), options);
  const schema = builder.build();
  return schema;
}

function createLoader(conn, data, options) {
  return new Loader(conn, data);
}

module.exports = { createSchema, createLoader };
