/*
const { Database } = require('./lib/model');
const { Document } = require('./lib/document');
const { Loader } = require('./lib/loader');
const { createSchema } = require('./lib/schema');

class Archen {
  constructor(schema, options = {}) {
    if (schema instanceof Buffer) {
      schema = schema.toString();
    }

    if (typeof schema === 'string') {
      try {
        schema = JSON.parse(schema);
      } catch (error) {
        schema = new Document(schema).json();
      }
    }

    this._model = new Database(schema, options);
    this._schema = createSchema(this._model);
  }

  getSchema() {
    return this._schema;
  }

  getContext(db) {
    return {
      loader: new Loader(this._model, db)
    };
  }
}

module.exports = function(schema, options) {
  return new Archen(schema, options);
};
*/
