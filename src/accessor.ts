import DataLoader = require('dataloader');

import { Schema, Model, SimpleField, ForeignKeyField } from './model';
import { Database, Value, Document, rowsToCamel, Filter } from './database';
import { Row, Connection } from './engine';
import { encodeFilter } from './filter';

interface FieldLoader {
  field: SimpleField;
  loader: DataLoader<Value, Row | Row[]>;
}

interface FieldLoaderMap {
  [key: string]: {
    [key: string]: FieldLoader;
  };
}

export class Accessor {
  db: Database;
  domain: Schema;
  loaders: FieldLoaderMap;
  queryLoader: DataLoader<string, Row[]>;

  constructor(schema: Schema, connection: Connection) {
    this.db = new Database(schema, connection);
    this.domain = this.db.schema;
    this.queryLoader = createQueryLoader(this.db.engine);
    this.loaders = {};
    for (const model of this.domain.models) {
      const loaders = {};
      for (const field of model.fields) {
        if (field.isUnique()) {
          loaders[field.name] = this._createLoader(field as SimpleField);
        }
      }
      this.loaders[model.name] = loaders;
    }
  }

  _createLoader(field: SimpleField): FieldLoader {
    const table = this.db.table(field.model);
    const loader = new DataLoader<Value, Row | Row[]>((keys: Value[]) => {
      return table.select('*', { where: { [field.name]: keys } }).then(rows => {
        const loaders = this.loaders[field.model.name];
        for (const row of rows) {
          for (const key in loaders) {
            if (key != field.name && loaders[key].field.isUnique()) {
              // TEST: order_shipping.order_id
              loaders[key].loader.prime(row[key] as Value, row);
            }
          }
        }
        return keys.map(k => rows.find(r => r[field.name] === k));
      });
    });
    return { field, loader };
  }

  // args: { where, limit, offset, orderBy }
  query(model: Model, args: Document) {
    let sql = `select * from ${this.db.engine.escapeId(model.table.name)}`;

    const where = encodeFilter(args.where as Filter, model, this.db.engine);
    if (where.length > 0) {
      sql += ` where ${where}`;
    }

    sql += ` limit ${args.limit || 50}`;

    if (args.offset !== undefined) {
      sql += ` offset ${args.offset}`;
    }

    if (args.orderBy !== undefined) {
      sql += ` order by ${args.orderBy}`;
    }

    const loaders = this.loaders[model.name];
    return this.queryLoader.load(sql).then(rows => {
      rows = rowsToCamel(rows, model);
      for (const row of rows) {
        for (const name in loaders) {
          loaders[name].loader.prime(row[name], row);
        }
      }
      return rows;
    });
  }

  get(model: Model, args: Document) {
    return this.db.table(model.name).get(args);
  }

  load(field: SimpleField, value: Value) {
    const loader = this.loaders[field.model.name][field.name].loader;
    return value ? loader.load(value) : null;
  }

  create(model: Model, args: Document) {
    return this.db.transaction(() => this.db.table(model).create(args));
  }

  update(model: Model, data: Document, filter: Filter) {
    return this.db.transaction(() => this.db.table(model).update(data, filter));
  }

  upsert(model: Model, data: Document, update: Document) {
    return this.db.transaction(() => this.db.table(model).upsert(data, update));
  }

  delete(model: Model, filter: Filter) {
    return this.db.transaction(() => this.db.table(model).delete(filter));
  }
}

function createQueryLoader(db: Connection): DataLoader<string, Row[]> {
  type Result = { index: number; response: Row[] };
  const loader = new DataLoader<string, Row[]>(
    (queries: string[]) =>
      new Promise(resolve => {
        const makePromise = (query: string, index: number) =>
          new Promise(resolve => {
            db
              .query(query)
              .then((response: Row[]) => resolve({ index, response }));
          });
        const promises = queries.map((query, index) =>
          makePromise(query, index)
        );
        Promise.all(promises).then((responses: Result[]) => {
          const results = [];
          responses.forEach(r => (results[r.index] = r.response));
          resolve(results);
        });
      }),
    { cache: false }
  );
  return loader;
}
