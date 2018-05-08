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

export class Accessor {
  db: Database;
  loaderMap: { [key: string]: LoaderEntry };

  constructor(db: Database | Schema, connection?: Connection) {
    if (db instanceof Database) {
      this.db = db;
    } else {
      this.db = new Database(db, connection);
    }
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
      return table.select('*', options).then(rows => {
        function __equal(row, key) {
          const value = row[field.name];
          if (field instanceof ForeignKeyField) {
            return value[field.referencedField.model.keyField().name] === key;
          } else {
            return value === key;
          }
        }
        if (field.isUnique()) {
          return keys.map(k => rows.find(r => __equal(r, k)));
        } else {
          return keys.map(k => rows.filter(r => __equal(r, k)));
        }
      });
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

      return table.select('*', options).then(rows => {
        const K0 = field.model.keyField().name;
        const K1 = field.referencingField.name;
        const K2 = field.throughField.name;
        const K3 = field.throughField.referencedField.model.keyField().name;

        const keySet = new Set(rows.map(row => row[K2][K3]));

        const options = {
          ...key,
          where: { [K3]: [...keySet] as string[], ...(key.where || {}) }
        };

        return this.db
          .table(field.throughField.referencedField.model)
          .select('*', options)
          .then(docs => {
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
          });
      });
    });

    this.loaderMap[keyCode] = { loader, key };

    return loader;
  }

  // args: { where, limit, offset, orderBy }
  query(model: Model, args: SelectOptions) {
    return this.db.table(model).select('*', args);
  }

  get(model: Model, args: Document) {
    return this.db.table(model.name).get(args);
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
    return this.db.transaction(() => this.db.table(model).create(args));
  }

  update(model: Model, data: Document, filter: Filter) {
    return this.db.transaction(() => this.db.table(model).modify(data, filter));
  }

  upsert(model: Model, create: Document, update: Document) {
    return this.db.transaction(() =>
      this.db.table(model).upsert(create, update)
    );
  }

  delete(model: Model, filter: Filter) {
    const table = this.db.table(model);
    return table.get(filter).then(row => {
      if (!row) return row;
      return this.db.transaction(() => table.delete(filter)).then(() => row);
    });
  }

  cursorQuery(model: Model, args, pluralName) {
    const options = {
      where: args.where,
      orderBy: args.orderBy,
      limit: args.first,
      cursor: args.after
    };
    return cursorQuery(this.db.table(model), options).then(edges => {
      const firstEdge = edges[0];
      const lastEdge = edges.slice(-1)[0];
      const pageInfo = {
        startCursor: firstEdge ? firstEdge.cursor : null,
        endCursor: lastEdge ? lastEdge.cursor : null,
        hasNextPage: edges.length === options.limit + 1
      };
      edges = edges.length > options.limit ? edges.slice(0, -1) : edges;
      return {
        edges,
        pageInfo,
        [pluralName]: edges.map(edge => edge.node)
      };
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
