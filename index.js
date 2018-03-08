const { Database } = require('./lib/model');
const { Loader } = require('./lib/loader');
const { createSchema } = require('./lib/schema');

const fs = require('fs');

class Archen {
  constructor(schema, options = {}) {
    if (typeof schema === 'string') {
      try {
        schema = JSON.parse(schema);
      } catch (error) {
        schema = JSON.parse(fs.readFileSync(schema).toString());
      }
    }

    this._model = new Database(schema);
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
