const express = require('express');
const graphqlHTTP = require('express-graphql');

const { Database } = require('./lib/database');
const { Document } = require('./lib/document');
const { Loader } = require('./lib/loader');
const { Builder } = require('./lib/builder');

const DEFAULT_OPTIONS = { plurals: {}, endpoint: '/graphql' };

class Archen {
  constructor(schema, knex, options = {}) {
    this.app = express();

    this.app.use(function(req, res, next) {
      req.loader = new Loader(knex, schema);
      next();
    });

    options = Object.assign({}, DEFAULT_OPTIONS, options);

    const httpOptions = {
      schema: new Builder(schema, options).build(),
      pretty: false,
    };

    if (options.debug) {
      httpOptions.graphiql = true;
      httpOptions.formatError = error => {
        console.error(error);
        const params = {
          message: error.message,
          state: error.originalError && error.originalError.state,
          locations: error.locations,
          path: error.path,
        };
        return params;
      };
    }

    this.app.use(options.endpoint, graphqlHTTP(httpOptions));
  }

  start(port, callback) {
    this.app.listen(port, callback);
  }
}

module.exports = { Archen, Database, Document };
