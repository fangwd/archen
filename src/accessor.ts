import DataLoader = require('dataloader');

import { Schema, Model, SimpleField, ForeignKeyField, Field } from './model';
import {
  Database,
  Value,
  Document,
  rowsToCamel,
  Filter,
  SelectOptions
} from './database';
import { Row, Connection } from './engine';
import { QueryBuilder } from './filter';
import { atob, btoa, toArray } from './misc';

interface FieldLoader {
  field: SimpleField;
  loader: DataLoader<Value, Row | Row[]>;
}

interface FieldLoaderMap {
  [key: string]: {
    [key: string]: FieldLoader;
  };
}

interface ConnectionSelectOptions {
  orderBy?: [string];
  after?: string;
  first?: number;
  where?: Filter;
}

export class Accessor {
  db: Database;
  loaders: FieldLoaderMap;
  queryLoader: DataLoader<string, Row[]>;

  constructor(db: Database) {
    this.db = db;
    this.queryLoader = createQueryLoader(this.db.engine);
    this.loaders = {};
    for (const model of this.db.schema.models) {
      const loaders = {};
      for (const field of model.fields) {
        if (field.isUnique() || field instanceof ForeignKeyField) {
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
    return { field, loader };
  }

  // args: { where, limit, offset, orderBy }
  query(model: Model, args: SelectOptions | string) {
    let sql;

    if (typeof args === 'string') {
      sql = args;
    } else {
      const builder = new QueryBuilder(model, this.db.engine);
      sql = builder.select('*', args.where, args.orderBy);
      if (args.limit) {
        sql += ` limit ${parseInt(args.limit + '')}`;
      }
      if (args.offset) {
        sql += ` offset ${parseInt(args.offset + '')}`;
      }
    }

    const loaders = this.loaders[model.name];
    return this.queryLoader.load(sql).then(rows => {
      rows = rowsToCamel(rows, model);
      for (const row of rows) {
        for (const name in loaders) {
          const loader = loaders[name];
          if (loader.field.isUnique()) {
            loader.loader.prime(row[name], row);
          }
        }
      }
      return rows;
    });
  }

  cursorQuery(model: Model, args: ConnectionSelectOptions) {
    let limit = 50;
    let where = {};
    let orderBy = model.primaryKey.fields.map(field => ({
      field: field as Field,
      direction: 'ASC'
    }));

    if (args.orderBy) {
      const argOrderBy = args.orderBy.map(order => {
        const [fieldName, direction] = order.split(' ');
        const field = model.field(fieldName);

        return { field, direction };
      });

      orderBy = [...argOrderBy, ...orderBy];
    }

    if (args.after) {
      const values: { [key: string]: any } = atob(args.after, orderBy);

      const multiColumnOrderWhere = (index, orders) => {
        const level = orders[index];
        const levelOp = level.direction === 'ASC' ? 'g' : 'l';
        const nextLevel = orders[index + 1];
        const nextLevelOp = nextLevel.direction === 'ASC' ? 'g' : 'l';

        if (index + 2 === orders.length) {
          return {
            and: [
              {
                [`${level.field.name}_${levelOp}e`]: values[level.field.name]
              },
              {
                or: [
                  {
                    [`${level.field.name}_${levelOp}t`]: values[
                      level.field.name
                    ]
                  },
                  {
                    [`${nextLevel.field.name}_${nextLevelOp}t`]: values[
                      nextLevel.field.name
                    ]
                  }
                ]
              }
            ]
          };
        }

        return {
          and: [
            {
              [`${level.field.name}_${levelOp}e`]: values[level.field.name]
            },
            {
              or: [
                {
                  [`${level.field.name}_${levelOp}t`]: values[level.field.name]
                },
                multiColumnOrderWhere(index + 1, orders)
              ]
            }
          ]
        };
      };

      where = multiColumnOrderWhere(0, orderBy);
    }

    if (args.where) {
      where = { ...args.where, ...where };
    }

    if (args.first) {
      limit = args.first;
    }

    const orderByArgs = orderBy.map(
      order => `${order.field.name} ${order.direction}`
    );

    return this.query(model, { where, orderBy: orderByArgs, limit }).then(
      rows => {
        const edges = rows.map(row => ({
          node: row,
          cursor: btoa(row, orderBy)
        }));

        const firstEdge = edges[0];
        const lastEdge = edges.slice(-1)[0];

        const pageInfo = {
          startCursor: firstEdge ? firstEdge.cursor : null,
          endCursor: lastEdge ? lastEdge.cursor : null,
          hasNextPage: edges.length === limit + 1
        };

        return {
          edges: edges.length > limit ? edges.slice(0, -1) : edges,
          pageInfo
        };
      }
    );
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
