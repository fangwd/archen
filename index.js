const express = require('express');
const graphqlHTTP = require('express-graphql');

const { Database } = require('./lib/database');
const { Document } = require('./lib/document');
const { Loader } = require('./lib/loader');
const { Builder } = require('./lib/builder');

class Archen {
  constructor(schema, knex, options = { plurals: {}, endpoint: '/graphql' }) {
    this.app = express();

    this.app.use(function(req, res, next) {
      req.loader = new Loader(knex, schema);
      next();
    });

    const builder = new Builder(schema, options);

    this.app.use(
      options.endpoint,
      graphqlHTTP({
        schema: builder.build(),
        graphiql: true,
      })
    );
  }

  start(port, callback) {
    this.app.listen(port, callback);
  }
}

module.exports = { Archen, Database, Document };
