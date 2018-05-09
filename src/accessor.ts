import DataLoader = require('dataloader');

import {
  Schema,
  Model,
  SimpleField,
  ForeignKeyField,
  Field,
  RelatedField
} from './model';

import {
  Database,
  Table,
  Value,
  Document,
  rowsToCamel,
  Filter,
  SelectOptions
} from './database';

import { Row, Connection } from './engine';
import { QueryBuilder } from './filter';
import { toArray } from './misc';
import { cursorQuery } from './cursor';

interface LoaderEntry {
  key: LoaderKey;
  loader: DataLoader<Value, Row | Row[]>;
}

interface ConnectionSelectOptions {
  orderBy?: [string];
  after?: string;
  first?: number;
  where?: Filter;
}

type Callback = (context: any, event: string, table: Table, data: any) => any;

export interface AccessorOptions {
  defaultLimit?: number;
  callbacks?: {
    context?: any;
    onQuery?: Callback;
    onResult?: Callback;
    onError?: Callback;
  };
}

export class Accessor {
  db: Database;
  options: AccessorOptions;
  loaderMap: { [key: string]: LoaderEntry };

  constructor(
    db: Database | Schema,
    connection?: Connection | AccessorOptions,
    callbacks?: AccessorOptions
  ) {
    if (db instanceof Database) {
      this.db = db;
      this.options = (connection as AccessorOptions) || {};
    } else {
      this.db = new Database(db, connection as Connection);
      this.options = callbacks || {};
    }
    this.options = { defaultLimit: 100, callbacks: {}, ...this.options };
    this.loaderMap = {};
  }

  getLoader(key: LoaderKey) {
    const keyCode = encodeLoaderKey(key);
    let entry = this.loaderMap[keyCode];

    if (entry) return entry.loader;

    const field = key.field;
    const table = this.db.table(field.model);

    const loader = new DataLoader<Value, Row | Row[]>((keys: Value[]) => {
      const where = Object.assign(key.where || {}, { [field.name]: keys });
      const options = Object.assign(key || {}, { where });
      return this.before('SELECT', table, options).then(() =>
        table.select('*', options).then(rows =>
          this.after('SELECT', table, { options, rows }).then(result => {
            const rows = result.rows;
            function __equal(row, key) {
              const value = row[field.name];
              if (field instanceof ForeignKeyField) {
                return (
                  value[field.referencedField.model.keyField().name] === key
                );
              } else {
                return value === key;
              }
            }
            if (field.isUnique()) {
              return keys.map(k => rows.find(r => __equal(r, k)));
            } else {
              return keys.map(k => rows.filter(r => __equal(r, k)));
            }
          })
        )
      );
    });

    this.loaderMap[keyCode] = { loader, key };

    return loader;
  }

  getLoaderRelated(key: LoaderKey) {
    const keyCode = encodeLoaderKey(key);

    let entry = this.loaderMap[keyCode];

    if (entry) return entry.loader;

    const field = key.field as RelatedField;

    const loader = new DataLoader<Value, Document[]>((keys: Value[]) => {
      const table = this.db.table(field.referencingField.model);
      const options = { where: { [field.referencingField.name]: keys } };

      return this.before('SELECT', table, options).then(options =>
        table.select('*', options).then(rows =>
          this.after('SELECT', table, { options, rows }).then(result => {
            const rows = result.rows;
            const K0 = field.model.keyField().name;
            const K1 = field.referencingField.name;
            const K2 = field.throughField.name;
            const K3 = field.throughField.referencedField.model.keyField().name;

            const keySet = new Set(rows.map(row => row[K2][K3]));

            const options = {
              ...key,
              where: { [K3]: [...keySet] as string[], ...(key.where || {}) }
            };

            const table = this.db.table(
              field.throughField.referencedField.model
            );

            return this.before('SELECT', table, options).then(options =>
              table.select('*', options).then(docs =>
                this.after('SELECT', table, { options, rows: docs }).then(
                  result => {
                    const docs = result.rows;
                    const docMap = docs.reduce((map, doc) => {
                      map[doc[K3] as string] = doc;
                      return map;
                    }, {});
                    const keyMap: any = rows.reduce((map, row) => {
                      const key = row[K1][K0];
                      if (!map[key]) {
                        map[key] = [];
                      }
                      if (docMap[row[K2][K3]]) {
                        (map[key] as any[]).push(docMap[row[K2][K3]]);
                      }
                      return map;
                    }, {});
                    return keys.map(key => keyMap[key as string] || []);
                  }
                )
              )
            );
          })
        )
      );
    });

    this.loaderMap[keyCode] = { loader, key };

    return loader;
  }

  // args: { where, limit, offset, orderBy }
  query(model: Model, options: SelectOptions) {
    const table = this.db.table(model);
    return this.before('SELECT', table, options).then(options =>
      table
        .select('*', options)
        .then(rows =>
          this.after('SELECT', table, { rows, ...options }).then(
            result => result.rows
          )
        )
    );
  }

  get(model: Model, filter: Document) {
    const table = this.db.table(model);
    return this.before('GET', table, { filter }).then(result =>
      table
        .get(result.filter)
        .then(row =>
          this.after('GET', table, { filter, row }).then(result => result.row)
        )
    );
  }

  load(key: LoaderKey, value: Value) {
    let loader;
    if (key.field instanceof RelatedField) {
      loader = this.getLoaderRelated(key);
    } else {
      loader = this.getLoader(key);
    }
    return value ? loader.load(value) : null;
  }

  create(model: Model, args: Document) {
    return this.before('CREATE', model, args).then(args =>
      this.db.transaction(() =>
        this.db
          .table(model)
          .create(args)
          .then(doc => this.after('CREATE', model, doc))
      )
    );
  }

  update(model: Model, data: Document, filter: Filter) {
    return this.before('UPDATE', model, { data, filter }).then(result =>
      this.db.transaction(() =>
        this.db
          .table(model)
          .modify(result.data, result.filter)
          .then(row => this.after('UPDATE', model, { data, filter, row }))
          .then(result => result.row)
      )
    );
  }

  upsert(model: Model, create: Document, update: Document) {
    return this.before('UPSERT', model, { create, update }).then(result =>
      this.db.transaction(() =>
        this.db
          .table(model)
          .upsert(result.create, result.update)
          .then(row => this.after('UPSERT', model, { create, update, row }))
          .then(result => result.row)
      )
    );
  }

  delete(model: Model, filter: Filter) {
    const table = this.db.table(model);
    return this.before('DELETE', table, { filter }).then(result =>
      table.get(result.filter).then(row => {
        if (!row)
          return this.after('DELETE', table, { filter, row }).then(
            result => result.row
          );
        return this.db
          .transaction(() => table.delete(filter))
          .then(() =>
            this.after('DELETE', table, { filter, row }).then(
              result => result.row
            )
          );
      })
    );
  }

  cursorQuery(model: Model, args, pluralName, fields) {
    const table = this.db.table(model);
    const limit = args.first || this.options.defaultLimit;

    const options = {
      where: args.where,
      orderBy: args.orderBy,
      limit: limit + 1,
      cursor: args.after || null,
      withTotal: !!(fields || {}).totalCount
    };

    return this.before('SELECT', table, options).then(options =>
      cursorQuery(table, options).then(result => {
        const { rows, totalCount } = result;
        return this.after('SELECT', table, { rows, ...options }).then(
          result => {
            let edges = result.rows.map(row => {
              const edge = {
                node: { ...row },
                cursor: row.__cursor
              };
              delete edge.node.__cursor;
              return edge;
            });
            const firstEdge = edges[0];
            const lastEdge = edges.slice(-1)[0];
            const pageInfo = {
              startCursor: firstEdge ? firstEdge.cursor : null,
              endCursor: lastEdge ? lastEdge.cursor : null,
              hasNextPage: edges.length === limit + 1
            };
            edges = edges.length > limit ? edges.slice(0, -1) : edges;
            return {
              totalCount,
              edges,
              pageInfo,
              [pluralName]: edges.map(edge => edge.node)
            };
          }
        );
      })
    );
  }

  before(event, table: Table | Model, data): Promise<any> {
    return this.runCallback(this.options.callbacks.onQuery, event, table, data);
  }

  after(event, table: Table | Model, data): Promise<any> {
    return this.runCallback(
      this.options.callbacks.onResult,
      event,
      table,
      data
    );
  }

  runCallback(callback, event, table: Table | Model, data): Promise<any> {
    if (table instanceof Model) {
      table = this.db.table(table);
    }
    return new Promise((resolve, reject) => {
      if (!callback) return resolve(data);
      try {
        function __check(result) {
          if (result === false) {
            return reject('Forbidden');
          } else if (result === undefined) {
            result = data;
          }
          resolve(result);
        }
        const result = callback.call(
          this,
          this.options.callbacks.context,
          event,
          table,
          data
        );
        if (result instanceof Promise) {
          result.then(__check);
        } else {
          __check(result);
        }
      } catch (error) {
        reject(error);
      }
    });
  }
}

interface LoaderKey extends SelectOptions {
  field: Field;
}

function encodeLoaderKey(key: LoaderKey): string {
  return JSON.stringify([
    key.field.model.name,
    key.field.name,
    key.where ? encodeFilter(key.where) : null,
    key.orderBy || null,
    key.limit || 0,
    key.offset || 0
  ]);
}

export function encodeFilter(filter) {
  if (Array.isArray(filter)) {
    return [0, filter.map(entry => encodeFilter(entry))];
  }
  if (filter && typeof filter === 'object' && !(filter instanceof Date)) {
    const keys = Object.keys(filter).sort();
    return [1, keys.map(key => [key, encodeFilter(filter[key])])];
  }
  return filter;
}
