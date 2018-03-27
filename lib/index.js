const { Database } = require('./model');
const { Document } = require('./document');
const { Loader } = require('./loader');
const { createSchema } = require('./schema');

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
