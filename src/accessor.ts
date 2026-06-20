import DataLoader = require('dataloader');
import { Database, Filter, Row, SelectOptions, Table } from 'sqlex';
import { Field, ForeignKeyField, Model, RelatedField } from 'sqlex/dist/schema';
import { Document, Value } from 'sqlex/dist/types';

import { cursorQuery } from './cursor';
import { hasOnly } from './schema';

interface LoaderEntry {
  key: LoaderKey;
  loader: DataLoader<Value, Document | Document[]>;
}

type Callback = (context: any, event: string, table: Table, data: any, root?: boolean) => any;

export interface AccessorOptions {
  defaultLimit?: number;
  callbacks?: {
    context?: any;
    onQuery?: Callback;
    onResult?: Callback;
    onError?: Callback;
  };
}

const DEFAULT_OPTIONS = {
  defaultLimit: 100,
  callbacks: {},
};
export class Accessor {
  db: Database;
  options: AccessorOptions;
  loaderMap: { [key: string]: LoaderEntry };

  constructor(db: Database, options?: AccessorOptions) {
    this.db = db;
    this.options = Object.assign({}, DEFAULT_OPTIONS, options);
    this.loaderMap = {};
  }

  getLoader(key: LoaderKey) {
    const keyCode = encodeLoaderKey(key);
    const entry = this.loaderMap[keyCode];

    if (entry) return entry.loader;

    const field = key.field;
    const table = this.db.table(field.model);

    const loader = new DataLoader<Value, Row | Row[]>((keys: readonly Value[]) => {
      const where = Object.assign({}, key.where || {}, { [field.name]: keys });
      const options = Object.assign({}, key || {}, { where });
      return this.before('SELECT', table, options).then(options =>
        table.select('*', options).then(rows =>
          this.after('SELECT', table, { options, rows }).then(result => {
            const rows: Row[] = result.rows;
            function __equal(row: any, key: any) {
              const value = row[field.name];
              if (field instanceof ForeignKeyField)
                return (
                  value[field.referencedField.model.keyField()!.name] === key
                );
               else
                return value === key;

            }
            if (field.isUnique())
              return keys.map(k => rows.find(r => __equal(r, k))) as (Row | Row[])[];
             else
              return keys.map(k => rows.filter(r => __equal(r, k)));

          })
        )
      );
    });

    this.loaderMap[keyCode] = { loader, key };

    return loader;
  }

  getLoaderRelated(key: LoaderKey, fields: Document) {
    const keyCode = encodeLoaderKey(key);

    const entry = this.loaderMap[keyCode];

    if (entry) return entry.loader;

    const field = key.field as RelatedField;

    const loader = new DataLoader<Value, Document[]>((keys: readonly Value[]) => {
      const table = this.db.table(field.referencingField.model);
      const options = { where: { [field.referencingField.name]: keys } };

      return this.before('SELECT', table, options).then(options =>
        table.select('*', options).then(rows =>
          this.after('SELECT', table, { options, rows }).then(result => {
            const rows = result.rows;
            const K0 = field.model.keyField()!.name;
            const K1 = field.referencingField.name;
            const K2 = field.throughField!.name;
            const K3 = field.throughField!.referencedField.model.keyField()!.name;

            if (hasOnly(fields, K3))
              return keys.map(key =>
                result.rows
                  .filter((row: any) => row[K1][K0] == key)
                  .map((row: any) => row[K2])
              );

            const keySet = new Set(rows.map((row: any) => row[K2][K3]));

            const options = {
              ...key,
              where: { [K3]: [...keySet] as string[], ...(key.where || {}) },
            };

            const table = this.db.table(
              field.throughField!.referencedField.model
            );

            return this.before('SELECT', table, options).then(options =>
              table.select('*', options).then(docs =>
                this.after('SELECT', table, { options, rows: docs }).then(
                  result => {
                    const docs = result.rows;
                    const docMap = docs.reduce((map: any, doc: any) => {
                      map[doc[K3] as string] = doc;
                      return map;
                    }, {});
                    const keyMap: any = rows.reduce((map: any, row: any) => {
                      const key = row[K1][K0];
                      if (!map[key])
                        map[key] = [];

                      if (docMap[row[K2][K3]])
                        (map[key] as any[]).push(docMap[row[K2][K3]]);

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
    // Cap unbounded list reads: a client that supplies no limit gets
    // defaultLimit rather than the whole table. Explicit limits are honored.
    if (options.limit === undefined)
      options = { ...options, limit: this.options.defaultLimit };
    return this.dispatch('SELECT', table, this.before('SELECT', table, options, true).then(options =>
      table
        .select('*', options)
        .then(rows =>
          this.after('SELECT', table, { rows, ...options }, true).then(
            result => result.rows
          )
        )
    ));
  }

  // Aggregate over a filtered set, returning one entry per group (or a single
  // entry when not grouping). `requested` is the per-entry selection subtree,
  // e.g. { keys: { status: {} }, count: {}, sum: { price: {} } }, so only the
  // requested functions/columns are computed.
  aggregate(model: Model, args: any, requested: any) {
    const table = this.db.table(model);
    const FUNCS = ['sum', 'avg', 'min', 'max'];
    const alias = (fn: string, field: string) =>
      fn + field.charAt(0).toUpperCase() + field.slice(1);
    // The requested columns under each function, ignoring introspection
    // meta-fields (e.g. __typename, which clients add automatically).
    const columnsOf = (sub: any): string[] =>
      sub && typeof sub === 'object'
        ? Object.keys(sub).filter(k => !k.startsWith('__'))
        : [];
    const groupBy: string[] = Array.isArray(args.groupBy) ? args.groupBy : [];

    const fields: string[] = [];
    for (const g of groupBy) fields.push(g); // select the grouped columns
    if (requested.count) fields.push('count(*) as count');
    for (const fn of FUNCS) {
      for (const field of columnsOf(requested[fn])) {
        fields.push(`${fn}(${field}) as ${alias(fn, field)}`);
      }
    }
    if (!fields.length) fields.push('count(*) as count');

    const data = { where: args.where, fields, groupBy };
    return this.dispatch('SELECT', table, this.before('SELECT', table, data, true).then(data => {
      const options: SelectOptions = { where: data.where };
      if (data.groupBy.length) options.groupBy = data.groupBy;
      return table.select(data.fields, options).then((rows: any[]) => {
        const entries = rows.map((row: any) => {
          const entry: any = {};
          if (groupBy.length) {
            entry.keys = {};
            for (const g of groupBy) entry.keys[g] = row[g];
          }
          if (requested.count) entry.count = Number(row.count);
          for (const fn of FUNCS) {
            const columns = columnsOf(requested[fn]);
            if (columns.length) {
              entry[fn] = {};
              for (const field of columns) {
                const value = row[alias(fn, field)];
                // sum/avg are numeric; min/max keep the column's own type.
                entry[fn][field] =
                  value != null && (fn === 'sum' || fn === 'avg')
                    ? Number(value)
                    : value;
              }
            }
          }
          return entry;
        });
        return this.after('SELECT', table, { rows: entries }, true).then(
          r => r.rows
        );
      });
    }));
  }

  get(model: Model, filter: Document) {
    const table = this.db.table(model);
    return this.dispatch('GET', table, this.before('GET', table, { filter }, true).then(result =>
      table
        .get(result.filter)
        .then(row =>
          this.after('GET', table, { filter, row }, true).then(
            result => result.row
          )
        )
    ));
  }

  load(key: LoaderKey, value: Value, fields?: Document) {
    let loader;
    if (key.field instanceof RelatedField)
      loader = this.getLoaderRelated(key, fields || {});
     else
      loader = this.getLoader(key);

    return value != null ? loader.load(value) : null;
  }

  create(model: Model, args: Document) {
    return this.dispatch('CREATE', model, this.before('CREATE', model, args).then(args =>
      this.db
        .table(model)
        .create(args)
        .then(doc => this.after('CREATE', model, doc))
    ));
  }

  update(model: Model, data: Document, filter: Filter) {
    return this.dispatch('UPDATE', model, this.before('UPDATE', model, { data, filter }).then(result =>
      this.db
        .table(model)
        .modify(result.data, result.filter)
        .then(row => this.after('UPDATE', model, { data, filter, row }))
        .then(result => result.row)
    ));
  }

  updateMany(model: Model, data: Document, filter: Filter) {
    return this.dispatch('UPDATE', model, this.before('UPDATE', model, { data, filter }).then(result =>
      this.db
        .table(model)
        .update(result.data, result.filter)
        .then(row => this.after('UPDATE', model, { data, filter, row }))
        .then(result => result.row)
    ));
  }

  upsert(model: Model, create: Document, update: Document) {
    return this.dispatch('UPSERT', model, this.before('UPSERT', model, { create, update }).then(result =>
      this.db
        .table(model)
        .upsert(result.create, result.update)
        .then(row => this.after('UPSERT', model, { create, update, row }))
        .then(result => result.row)
    ));
  }

  delete(model: Model, filter: Filter) {
    const table = this.db.table(model);
    return this.dispatch('DELETE', table, this.before('DELETE', table, { filter }).then(result =>
      table.get(result.filter).then(row => {
        if (!row)
          return this.after('DELETE', table, { filter, row }).then(
            result => result.row
          );
        return table
          .delete(filter)
          .then(() =>
            this.after('DELETE', table, { filter, row }).then(
              result => result.row
            )
          );
      })
    ));
  }

  deleteMany(model: Model, filter: Filter) {
    const table = this.db.table(model);
    return this.dispatch('DELETE', table, this.before('DELETE', table, { filter }).then(result =>
      table
        .delete(result.filter)
        .then(result => this.after('DELETE', table, { filter, result }))
        .then(result => result.result)
    ));
  }

  cursorQuery(model: Model, args: any, pluralName: string, fields?: any, root?: boolean) {
    const table = this.db.table(model);
    const backward = args.last != null;
    const limit = (backward ? args.last : args.first) || this.options.defaultLimit;

    const options = {
      where: args.where,
      orderBy: args.orderBy,
      limit: limit + 1,
      cursor: (backward ? args.before : args.after) || null,
      before: backward,
      withTotal: !!(fields || {}).totalCount,
    };

    return this.dispatch('SELECT', table, this.before('SELECT', table, options, root).then(options =>
      cursorQuery(table, options).then(result => {
        const { totalCount } = result;
        return this.after('SELECT', table, { rows: result.rows, ...options }, root).then(
          result => {
            let edges = result.rows.map((row: any) => {
              const edge = {
                node: { ...row },
                cursor: row.__cursor,
              };
              delete edge.node.__cursor;
              return edge;
            });
            // limit+1 rows were fetched; the extra row signals another page.
            // It sits at the end (forward) or, after reversal, the front
            // (backward).
            const hasExtra = edges.length > limit;
            if (hasExtra)
              edges = backward ? edges.slice(1) : edges.slice(0, -1);
            const firstEdge = edges[0];
            const lastEdge = edges.slice(-1)[0];
            const pageInfo = {
              startCursor: firstEdge ? firstEdge.cursor : null,
              endCursor: lastEdge ? lastEdge.cursor : null,
              // The paginated direction is accurate; the opposite direction
              // is known to have a page only when a cursor was supplied.
              hasNextPage: backward ? !!options.cursor : hasExtra,
              hasPreviousPage: backward ? hasExtra : !!options.cursor,
            };
            return {
              totalCount,
              edges,
              pageInfo,
              [pluralName]: edges.map((edge: any) => edge.node),
            };
          }
        );
      })
    ));
  }

  before(event: string, table: Table | Model, data: any, root?: boolean): Promise<any> {
    return this.runCallback(
      this.options.callbacks?.onQuery,
      event,
      table,
      data,
      root
    );
  }

  after(event: string, table: Table | Model, data: any, root?: boolean): Promise<any> {
    return this.runCallback(
      this.options.callbacks?.onResult,
      event,
      table,
      data,
      root
    );
  }

  // Routes a failed operation through the onError callback. The handler is
  // for observation/transformation: if it throws, that error propagates;
  // otherwise the original error is rethrown.
  dispatch<T>(event: string, table: Table | Model, work: Promise<T>): Promise<T> {
    const callback = this.options.callbacks?.onError;
    if (!callback) return work;
    return work.catch(error => {
      if (table instanceof Model) table = this.db.table(table);
      callback.call(this, this.options.callbacks?.context, event, table, error);
      throw error;
    });
  }

  runCallback(
    callback: Callback | undefined,
    event: string,
    table: Table | Model,
    data: any,
    root?: boolean
  ): Promise<any> {
    if (table instanceof Model)
      table = this.db.table(table);

    return new Promise((resolve, reject) => {
      if (!callback) return resolve(data);
      try {
        function __check(result: any) {
          if (result === false)
            return reject(new Error('Forbidden'));
           else if (result === undefined)
            result = data;

          resolve(result);
        }
        const result = callback.call(
          this,
          this.options.callbacks?.context,
          event,
          table,
          data,
          root
        );
        if (result instanceof Promise)
          result.then(__check);
         else
          __check(result);

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
    key.offset || 0,
  ]);
}

export function encodeFilter(filter: any): any {
  if (Array.isArray(filter))
    return [0, filter.map(entry => encodeFilter(entry))];

  if (filter && typeof filter === 'object' && !(filter instanceof Date)) {
    const keys = Object.keys(filter).sort();
    return [1, keys.map(key => [key, encodeFilter(filter[key])])];
  }
  return filter;
}
