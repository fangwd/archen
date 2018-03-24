import DataLoader = require('dataloader');
import knex = require('knex');
import { Value, Row, QueryArgs, rowsToCamel } from './common';
import { Domain, Model, SimpleField, ForeignKeyField } from './domain';
import { QueryBuilder, buildQuery } from './query-builder';
import { createOne, updateOne, upsertOne, deleteOne } from './mutation';

interface FieldLoader {
  field: SimpleField;
  loader: DataLoader<Value, Row | Row[]>;
}

interface FieldLoaderMap {
  [key: string]: {
    [key: string]: FieldLoader;
  };
}

class Connector {
  db: knex;
  domain: Domain;
  loaders: FieldLoaderMap;
  queryLoader: DataLoader<string, Row[]>;

  constructor(domain: Domain, db: knex) {
    this.db = db;
    this.queryLoader = createQueryLoader(db);
    this.loaders = {};
    this.domain = domain;
    for (const model of this.domain.models) {
      const loaders = {};
      for (const key of model.uniqueKeys) {
        if (key.fields.length == 1) {
          const field = key.fields[0];
          loaders[field.name] = this._createLoader(field);
        }
      }
      for (const field of model.fields) {
        if (field instanceof ForeignKeyField) {
          loaders[field.name] = this._createLoader(field);
        }
      }
      this.loaders[model.name] = loaders;
    }
  }

  _createLoader(field: SimpleField): FieldLoader {
    const me = this;
    const loader = new DataLoader<Value, Row | Row[]>((keys: Value[]) => {
      return new Promise((resolve, reject) => {
        me.db
          .table(field.model.table.name)
          .whereIn(field.column.name, keys)
          .then(result => {
            const rows = rowsToCamel(result, field.model);
            const loaders = me.loaders[field.model.name];
            for (const row of rows) {
              for (const key in loaders) {
                if (key != field.name && loaders[key].field.isUnique) {
                  loaders[key].loader.prime(row[key], row);
                }
              }
            }
            if (field.isUnique()) {
              resolve(keys.map(k => rows.find(r => r[field.name] === k)));
            } else {
              resolve(keys.map(k => rows.filter(r => r[field.name] === k)));
            }
          });
      });
    });
    return { field, loader };
  }

  // args: { where, limit, offset, orderBy }
  query(model: Model, args: QueryArgs) {
    const query = buildQuery(this.db, model, args);
    const loaders = this.loaders[model.name];
    return this.queryLoader.load(query.toString()).then(rows => {
      rows = rowsToCamel(rows, model);
      for (const row of rows) {
        for (const name in loaders) {
          if (loaders[name].field.isUnique()) {
            loaders[name].loader.prime(row[name], row);
          }
        }
      }
      return rows;
    });
  }

  load(field: SimpleField, value: Value) {
    const loader = this.loaders[field.model.name][field.name].loader;
    return value ? loader.load(value) : null;
  }

  create(model: Model, args: QueryArgs) {
    return this.db.transaction(trx => createOne(trx, model, args));
  }

  update(table, args) {
    return this.db.transaction(trx => updateOne(trx, table, args));
  }

  upsert(table, args) {
    return this.db.transaction(trx => upsertOne(trx, table, args));
  }

  delete(table: Model, args: QueryArgs) {
    return deleteOne(this.db, table, args);
  }
}

function createQueryLoader(db: knex): DataLoader<string, Row[]> {
  type Result = { index: number; response: Row[] };
  const loader = new DataLoader<string, Row[]>(
    (queries: string[]) =>
      new Promise(resolve => {
        const makePromise = (query: string, index: number) =>
          new Promise(resolve => {
            db
              .raw(query)
              .then((response: Row[]) => resolve({ index, response }));
          });
        const promises = queries.map((query, index) =>
          makePromise(query, index)
        );
        Promise.all(promises).then((responses: Result[]) => {
          const results = [];
          if (/mysql/i.test(db.client.dialect)) {
            responses.forEach(r => (results[r.index] = r.response[0]));
          } else {
            // sqlite3
            responses.forEach(r => (results[r.index] = r.response));
          }
          resolve(results);
        });
      }),
    { cache: false }
  );
  return loader;
}
