import DataLoader = require('dataloader');
import knex = require('knex');
import { Value, Row, Document, rowsToCamel } from './common';
import { Schema, Model, SimpleField, ForeignKeyField } from './model';
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
  domain: Schema;
  loaders: FieldLoaderMap;
  queryLoader: DataLoader<string, Row[]>;

  constructor(domain: Schema, db: knex) {
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
  query(model: Model, args: Document) {
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

  create(model: Model, args: Document) {
    return this.db.transaction(trx => createOne(trx, model, args));
  }

  update(table, args) {
    return this.db.transaction(trx => updateOne(trx, table, args));
  }

  upsert(table, args) {
    return this.db.transaction(trx => upsertOne(trx, table, args));
  }

  delete(table: Model, args: Document) {
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

export function buildQuery(db: knex, table: Model, args: Document) {
  const builder = new QueryBuilder(db, table);
  const query = builder.select();

  if (args.where) {
    const where = args.where as Document;
    builder.join(query, where);
    builder.reset(table);
    query.where(builder.buildWhere(where));
  }

  if (args.limit !== undefined) {
    query.limit(args.limit as number);
  } else {
    query.limit(50); // DEFAULT_LIMIT
  }

  if (args.offset !== undefined) {
    query.offset(args.offset as number);
  }

  if (args.orderBy !== undefined) {
    query.orderBy(args.orderBy as string);
  }

  return query;
}
