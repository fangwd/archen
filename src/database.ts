import { Value } from './engine';

export type Document = {
  [key: string]: Value | Value[] | Document | Document[];
};

export type Filter = Document | Document[];

import {
  Schema,
  Model,
  Field,
  SimpleField,
  ForeignKeyField,
  RelatedField,
  ColumnInfo,
  UniqueKey
} from './model';

import { Connection, ConnectionPool, Row } from './engine';
import { encodeFilter, QueryBuilder } from './filter';
import { toArray } from './misc';

import {
  RecordProxy,
  FlushState,
  FlushMethod,
  flushDatabase,
  flushRecord
} from './flush';

import { createNode, moveSubtree, deleteSubtree, treeQuery } from './tree';

class ClosureTable {
  constructor(
    public table: Table,
    public ancestor: ForeignKeyField,
    public descendant: ForeignKeyField,
    public depth?: SimpleField
  ) {}
}

export class Database {
  schema: Schema;
  pool: ConnectionPool;
  tableMap: { [key: string]: Table } = {};
  tableList: Table[] = [];

  constructor(schema: Schema, pool: ConnectionPool) {
    this.schema = schema;
    this.pool = pool;

    for (const model of schema.models) {
      const table = new Table(this, model);
      this.tableMap[model.name] = table;
      this.tableMap[model.table.name] = table;
      this.tableList.push(table);
      this[model.name] = data => {
        const record = new Proxy(new Record(table), RecordProxy);
        Object.assign(record, data);
        return record;
      };
    }

    for (const model of schema.models) {
      if (model.config.closureTable) {
        const config = model.config.closureTable;
        const fields: any = config.fields || {};

        const table = this.table(config.name);
        if (!table) {
          throw Error(`Table ${config.name} not found.`);
        }

        let fieldName = fields.ancestor || 'ancestor';
        const ancestor = table.model.field(fieldName);
        if (!ancestor || !(ancestor instanceof ForeignKeyField)) {
          throw Error(`Field ${fieldName} is not a foreign key`);
        }

        fieldName = fields.descendant || 'descendant';
        const descendant = table.model.field(fieldName);
        if (!descendant || !(descendant instanceof ForeignKeyField)) {
          throw Error(`Field ${fieldName} is not a foreign key`);
        }

        let depth: SimpleField;
        if (fields.depth) {
          depth = table.model.field(fields.depth) as SimpleField;
          if (!depth) {
            throw Error(`Field ${fields.depth} not found`);
          }
        }

        this.table(model).closureTable = new ClosureTable(
          table,
          ancestor,
          descendant,
          depth
        );
      }
    }
  }

  table(name: string | Field | Model): Table {
    if (name instanceof Field) {
      name = name.model.name;
    } else if (name instanceof Model) {
      name = name.name;
    }
    return this.tableMap[name];
  }

  model(name: string): Model {
    return this.table(name).model;
  }

  append(name: string, data: { [key: string]: any }): any {
    return this.table(name).append(data);
  }

  getDirtyCount(): number {
    return this.tableList.reduce((count, table) => {
      count += table.getDirtyCount();
      return count;
    }, 0);
  }

  flush() {
    return this.pool.getConnection().then(connection =>
      connection.transaction(() =>
        flushDatabase(connection, this).then(result => {
          connection.release();
          return connection;
        })
      )
    );
  }

  clear() {
    for (const name in this.tableMap) {
      this.tableMap[name].clear();
    }
  }

  json() {
    return this.tableList.reduce((result, table) => {
      result[table.model.name] = table.json();
      return result;
    }, {});
  }
}

export type OrderBy = string | string[];

export interface SelectOptions {
  where?: Filter;
  offset?: number;
  limit?: number;
  orderBy?: OrderBy;
}

export class Table {
  db: Database;
  model: Model;
  closureTable?: ClosureTable;

  recordList: Record[] = [];
  recordMap: { [key: string]: { [key: string]: Record } };

  constructor(db: Database, model: Model) {
    this.db = db;
    this.model = model;
    this._initMap();
  }

  column(name: string): ColumnInfo {
    const field = this.model.field(name) as SimpleField;
    return field.column;
  }

  getParentField(model?: Model): ForeignKeyField {
    return this.model.getForeignKeyOf(model || this.model);
  }

  getAncestors(row: Value | Document, filter?: Filter): Promise<Document[]> {
    const field = this.closureTable.ancestor;
    return this.db.pool.getConnection().then(connection =>
      treeQuery(connection, this, row, field, filter).then(result => {
        connection.release();
        return result;
      })
    );
  }

  getDescendants(row: Value | Document, filter?: Filter): Promise<Document[]> {
    const field = this.closureTable.descendant;
    return this.db.pool.getConnection().then(connection =>
      treeQuery(connection, this, row, field, filter).then(result => {
        connection.release();
        return result;
      })
    );
  }

  select(
    fields: string,
    options: SelectOptions = {},
    filterThunk?: (builder: QueryBuilder) => string
  ): Promise<Row[]> {
    return this.db.pool.getConnection().then(connection =>
      this._select(connection, fields, options, filterThunk).then(result => {
        connection.release();
        return result;
      })
    );
  }

  get(key: Value | Filter): Promise<Document> {
    return this.db.pool.getConnection().then(connection =>
      this._get(connection, key).then(result => {
        connection.release();
        return result;
      })
    );
  }

  insert(data: Row): Promise<any> {
    return this.db.pool.getConnection().then(connection =>
      this._insert(connection, data).then(result => {
        connection.release();
        return result;
      })
    );
  }

  create(data: Document): Promise<Document> {
    return this.db.pool.getConnection().then(connection =>
      connection.transaction(() =>
        this._create(connection, data).then(result => {
          connection.release();
          return result;
        })
      )
    );
  }

  update(data: Document, filter: Filter): Promise<any> {
    return this.db.pool.getConnection().then(connection =>
      this._update(connection, data, filter).then(result => {
        connection.release();
        return result;
      })
    );
  }

  upsert(data: Document, update?: Document): Promise<Document> {
    return this.db.pool.getConnection().then(connection =>
      connection.transaction(() =>
        this._upsert(connection, data, update).then(result => {
          connection.release();
          return result;
        })
      )
    );
  }

  modify(data: Document, filter: Filter): Promise<Document> {
    return this.db.pool.getConnection().then(connection =>
      connection.transaction(() =>
        this._modify(connection, data, filter).then(result => {
          connection.release();
          return result;
        })
      )
    );
  }

  delete(filter: Filter): Promise<any> {
    return this.db.pool.getConnection().then(connection => {
      if (this.closureTable) {
        return connection.transaction(() =>
          this._delete(connection, filter).then(result => {
            connection.release();
            return result;
          })
        );
      } else {
        return this._delete(connection, filter).then(result => {
          connection.release();
          return result;
        });
      }
    });
  }

  count(filter?: Filter): Promise<number> {
    let sql = `select count(1) as result from ${this._name()}`;

    if (filter) {
      sql += ` where ${this._where(filter)}`;
    }

    return this.db.pool.getConnection().then(connection =>
      connection.query(sql).then(rows => {
        connection.release();
        return parseInt(rows[0].result);
      })
    );
  }

  private _name(): string {
    return this.db.pool.escapeId(this.model.table.name);
  }

  private _where(filter: Filter) {
    return encodeFilter(filter, this.model, this.db.pool);
  }

  private _pair(name: string | SimpleField, value: Value): string {
    if (typeof name === 'string') {
      name = this.model.field(name) as SimpleField;
    }
    return this.escapeName(name) + '=' + this.escapeValue(name, value);
  }

  private _select(
    connection: Connection,
    fields: string,
    options: SelectOptions = {},
    filterThunk?: (builder: QueryBuilder) => string
  ): Promise<Row[]> {
    let sql = new QueryBuilder(this.model, this.db.pool).select(
      fields,
      options.where,
      options.orderBy,
      filterThunk
    );

    if (options.limit !== undefined) {
      sql += ` limit ${parseInt(options.limit + '')}`;
    }

    if (options.offset !== undefined) {
      sql += ` offset ${parseInt(options.offset + '')}`;
    }

    return connection.query(sql).then(rows => {
      return filterThunk ? rows : rows.map(row => toDocument(row, this.model));
    });
  }

  _update(
    connection: Connection,
    data: Document,
    filter: Filter
  ): Promise<any> {
    let sql = `update ${this._name()} set`;
    let cnt = 0;

    const keys = Object.keys(data);
    for (let i = 0; i < keys.length; i++) {
      const field = this.model.field(keys[i]);
      if (field instanceof SimpleField) {
        if (i > 0) {
          sql += ',';
        }
        sql += this._pair(field, data[keys[i]] as Value);
        cnt++;
      }
    }

    if (cnt === 0) {
      return Promise.resolve();
    }

    if (filter) {
      if (typeof filter === 'string') {
        sql += ` where ${filter}`;
      } else {
        sql += ` where ${this._where(filter)}`;
      }
    }

    return connection.query(sql);
  }

  _insert(connection: Connection, data: Row): Promise<any> {
    const keys = Object.keys(data);
    const name = keys.map(key => this.escapeName(key)).join(', ');
    const value = keys.map(key => this.escapeValue(key, data[key])).join(', ');
    const sql = `insert into ${this._name()} (${name}) values (${value})`;
    return connection.query(sql);
  }

  _delete(connection: Connection, filter: Filter): Promise<any> {
    const scope = filter ? `${this._where(filter)}` : '';

    const __delete = () => {
      let sql = `delete from ${this._name()}`;
      if (scope) {
        sql += ` where ${scope}`;
      }
      return connection.query(sql);
    };

    if (this.closureTable) {
      return deleteSubtree(connection, this, scope).then(() => __delete());
    } else {
      return __delete();
    }
  }

  escapeName(name: SimpleField | string | number): string {
    if (name instanceof SimpleField) {
      name = name.column.name;
    } else {
      if (typeof name === 'number') {
        return name + '';
      }
      if (name === '*') return name;
      name = (this.model.field(name) as SimpleField).column.name;
    }
    return this.db.pool.escapeId(name);
  }

  escapeValue(field: SimpleField | string, value: Value): string {
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    if (value === null || value === undefined) {
      return 'null';
    }
    if (typeof field === 'string') {
      field = this.model.field(field) as SimpleField;
    }
    return this.db.pool.escape(_toSnake(value, field) + '');
  }

  _get(connection: Connection, key: Value | Filter): Promise<Document> {
    if (key === null || typeof key !== 'object') {
      key = {
        [this.model.keyField().name]: key
      };
    } else if (!this.model.checkUniqueKey(key)) {
      const msg = `Bad selector: ${JSON.stringify(key)}`;
      return Promise.reject(Error(msg));
    }
    return this._select(connection, '*', { where: key } as SelectOptions).then(
      rows => rows[0]
    );
  }

  // GraphQL mutations
  _resolveParentFields(
    connection: Connection,
    input: Document,
    filter?: Filter
  ): Promise<Row> {
    const result: Row = {};
    const promises = [];
    const self = this;

    function _createPromise(field: ForeignKeyField, data: Document): void {
      const table = self.db.table(field.referencedField.model);
      const method = Object.keys(data)[0];
      let promise;
      switch (method) {
        case 'connect':
          promise = table._get(connection, data[method] as Document);
          break;
        case 'create':
          promise = table._create(connection, data[method] as Document);
          break;
        case 'update':
          {
            const where = { [field.relatedField.name]: filter };
            promise = table._modify(
              connection,
              data[method] as Document,
              where
            );
          }
          break;
        default:
          throw Error(`Unsuported method '${method}'`);
      }

      if (method !== 'update') {
        promise.then(row => {
          result[field.name] = row
            ? row[field.referencedField.model.keyField().name]
            : null;
          return row;
        });
      }

      promises.push(promise);
    }

    for (const key in input) {
      let field = this.model.field(key);
      if (
        field instanceof ForeignKeyField &&
        input[key] &&
        typeof input[key] === 'object'
      ) {
        _createPromise(field, input[key] as Document);
      } else if (field instanceof SimpleField) {
        result[key] = input[key] as Value;
      }
    }

    return Promise.all(promises).then(() => result);
  }

  private _create(connection: Connection, data: Document): Promise<Document> {
    if (Object.keys(data).length === 0) throw Error('Empty data');

    return this._resolveParentFields(connection, data).then(row =>
      this._insert(connection, row).then(id => {
        return this._updateChildFields(connection, data, id).then(() =>
          this._get(connection, id).then(
            row =>
              this.closureTable
                ? createNode(connection, this, row).then(() => row)
                : row
          )
        );
      })
    );
  }

  private _upsert(
    connection,
    data: Document,
    update?: Document
  ): Promise<Document> {
    if (!this.model.checkUniqueKey(data)) {
      return Promise.reject(`Incomplete: ${JSON.stringify(data)}`);
    }

    const self = this;

    return this._resolveParentFields(connection, data).then(row => {
      const uniqueFields = self.model.getUniqueFields(row);
      return self._get(connection, uniqueFields).then(row => {
        if (!row) {
          return self._create(connection, data);
        } else {
          if (update && Object.keys(update).length > 0) {
            return self._modify(connection, update, uniqueFields);
          } else {
            return row;
          }
        }
      });
    });
  }

  private _modify(
    connection,
    data: Document,
    filter: Filter
  ): Promise<Document> {
    if (!this.model.checkUniqueKey(filter)) {
      return Promise.reject(`Bad filter: ${JSON.stringify(filter)}`);
    }

    const self = this;

    return this._resolveParentFields(connection, data, filter).then(row => {
      return self._update(connection, row, filter).then(() => {
        const where = Object.assign({}, filter);
        for (const key in where) {
          if (key in row) {
            where[key] = row[key];
          }
        }
        return self._get(connection, where as Document).then(row => {
          if (row) {
            const id = row[this.model.keyField().name] as Value;
            return this._updateChildFields(connection, data, id).then(
              () =>
                !this.closureTable || !data[this.getParentField().name]
                  ? row
                  : moveSubtree(connection, this, row).then(() => row)
            );
          } else {
            return Promise.resolve(row);
          }
        });
      });
    });
  }

  private _updateChildFields(
    connection: Connection,
    data: Document,
    id: Value
  ): Promise<void> {
    const promises = [];
    for (const key in data) {
      let field = this.model.field(key);
      if (field instanceof RelatedField) {
        promises.push(
          this._updateChildField(connection, field, id, data[key] as Document)
        );
      }
    }
    return Promise.all(promises).then(() => Promise.resolve());
  }

  private _updateChildField(
    connection: Connection,
    related: RelatedField,
    id: Value,
    data: Document
  ): Promise<void> {
    const promises = [];
    const field = related.referencingField;
    if (!field) throw Error(`Bad field ${related.displayName()}`);
    const table = this.db.table(field.model);
    if (!data || field.model.keyValue(data) === null) {
      const nullable = field.column.nullable;
      if (field.column.nullable) {
        return table._update(
          connection,
          { [field.name]: null },
          { [field.name]: id }
        );
      } else {
        return table._delete(connection, { [field.name]: id });
      }
    }
    for (const method in data) {
      const args = data[method] as Document[];
      if (method === 'connect') {
        if (related.throughField) {
          promises.push(this._connectThrough(connection, related, id, args));
          continue;
        }
        // connect: [{parent: {id: 2}, name: 'Apple'}, ...]
        for (const arg of toArray(args)) {
          if (!table.model.checkUniqueKey(arg)) {
            return Promise.reject(`Bad filter (${table.model.name})`);
          }
          let promise;
          if (field.isUnique()) {
            promise = this._disconnectUnique(connection, field, id).then(() =>
              table._update(connection, { [field.name]: id }, args)
            );
          } else {
            promise = table._update(connection, { [field.name]: id }, args);
          }
          promises.push(promise);
        }
      } else if (method === 'create') {
        if (related.throughField) {
          promises.push(this._createThrough(connection, related, id, args));
          continue;
        }
        // create: [{parent: {id: 2}, name: 'Apple'}, ...]
        const docs = toArray(args).map(arg => ({ [field.name]: id, ...arg }));
        if (field.isUnique()) {
          promises.push(
            this._disconnectUnique(connection, field, id).then(() =>
              table._create(connection, docs[0])
            )
          );
        } else {
          for (const doc of docs) {
            promises.push(table._create(connection, doc));
          }
        }
      } else if (method === 'upsert') {
        if (related.throughField) {
          promises.push(this._upsertThrough(connection, related, id, args));
          continue;
        }
        const rows = [];
        for (const arg of toArray(args)) {
          let { create, update } = arg;
          if (!create && !field.isUnique()) {
            throw Error('Bad data');
          }
          create = Object.assign({ [field.name]: id }, create);
          if (create[field.name] === undefined) {
            update = Object.assign({ [field.name]: id }, update);
          }
          promises.push(
            table._upsert(connection, create as Document, update as Document)
          );
        }
      } else if (method === 'update') {
        if (related.throughField) {
          promises.push(this._updateThrough(connection, related, id, args));
          continue;
        }
        for (const arg of toArray(args)) {
          let data, where;
          if (arg.data === undefined) {
            data = arg;
            where = {};
          } else {
            data = arg.data;
            where = arg.where;
          }
          const filter = { [field.name]: id, ...where };
          promises.push(table._modify(connection, data, filter));
        }
      } else if (method.startsWith('delete')) {
        if (related.throughField) {
          promises.push(this._deleteThrough(connection, related, id, args));
          continue;
        }
        const filter = args.map(arg => ({
          ...(arg /*.where*/ as Document),
          [field.name]: id
        }));
        promises.push(table._delete(connection, filter as Filter));
      } else if (method.startsWith('disconnect')) {
        if (related.throughField) {
          promises.push(this._disconnectThrough(connection, related, id, args));
          continue;
        }
        const where = args.map(arg => ({ [field.name]: id, ...arg }));
        promises.push(table._update(connection, { [field.name]: null }, where));
      } else if (method === 'set') {
        const promise = related.throughField
          ? this._deleteThrough(connection, related, id, [])
          : table._delete(connection, { [field.name]: id });
        promises.push(
          promise.then(() => {
            if (related.throughField) {
              return this._createThrough(connection, related, id, args);
            }
            // create: [{parent: {id: 2}, name: 'Apple'}, ...]
            const docs = toArray(args).map(arg => ({
              [field.name]: id,
              ...arg
            }));
            if (field.isUnique()) {
              return this._disconnectUnique(connection, field, id).then(() =>
                table._create(connection, docs[0])
              );
            } else {
              return Promise.all(
                docs.map(doc => {
                  table._create(connection, doc);
                })
              );
            }
          })
        );
      } else {
        throw Error(`Unknown method: ${method}`);
      }
    }

    return Promise.all(promises).then(() => Promise.resolve());
  }

  _disconnectUnique(
    connection: Connection,
    field: SimpleField,
    id: Value
  ): Promise<any> {
    const table = this.db.table(field.model);
    return field.column.nullable
      ? table._update(connection, { [field.name]: null }, { [field.name]: id })
      : table._delete(connection, { [field.name]: id });
  }

  _connectThrough(
    connection: Connection,
    related: RelatedField,
    value: Value,
    args: Document[]
  ): Promise<any> {
    const table = this.db.table(related.throughField.referencedField.model);
    const mapping = this.db.table(related.throughField.model);
    const promises = args.map(arg =>
      table._get(connection, arg).then(row =>
        mapping._create(connection, {
          [related.referencingField.name]: value,
          [related.throughField.name]: row[table.model.keyField().name]
        })
      )
    );
    return Promise.all(promises);
  }

  private _createThrough(
    connection: Connection,
    related: RelatedField,
    value: Value,
    args: Document[]
  ): Promise<any> {
    const table = this.db.table(related.throughField.referencedField.model);
    const mapping = this.db.table(related.throughField.model);
    const promises = args.map(arg =>
      table._create(connection, arg).then(row =>
        mapping._create(connection, {
          [related.referencingField.name]: value,
          [related.throughField.name]: row[table.model.keyField().name]
        })
      )
    );
    return Promise.all(promises);
  }

  private _upsertThrough(
    connection: Connection,
    related: RelatedField,
    value: Value,
    args: Document[]
  ): Promise<any> {
    const table = this.db.table(related.throughField.referencedField.model);
    const mapping = this.db.table(related.throughField.model);
    const promises = args.map(arg =>
      table
        ._upsert(connection, arg.create as Document, arg.update as Document)
        .then(row =>
          mapping._upsert(connection, {
            [related.referencingField.name]: value,
            [related.throughField.name]: row[table.model.keyField().name]
          })
        )
    );
    return Promise.all(promises);
  }

  private _updateThrough(
    connection: Connection,
    related: RelatedField,
    value: Value,
    args: Document[]
  ): Promise<any> {
    const model = related.throughField.referencedField.model;
    const promises = args.map(arg => {
      let where;
      if (related.throughField.relatedField.throughField) {
        where = {
          [related.throughField.relatedField.name]: {
            [related.model.keyField().name]: value
          },
          ...(arg.where as object)
        };
      } else {
        where = {
          [related.throughField.relatedField.name]: {
            [related.referencingField.name]: value
          },
          ...(arg.where as object)
        };
      }
      return this.db
        .table(model)
        ._modify(connection, arg.data as Document, where);
    });
    return Promise.all(promises);
  }

  _deleteThrough(
    connection: Connection,
    related: RelatedField,
    value: Value,
    args: Document[]
  ): Promise<any> {
    const mapping = this.db.table(related.throughField.model);
    const table = this.db.table(related.throughField.referencedField.model);
    return mapping
      ._select(connection, '*', {
        where: {
          [related.referencingField.name]: value,
          [related.throughField.name]: args
        }
      })
      .then(rows => {
        if (rows.length === 0) return Promise.resolve(0);
        const values = rows.map(
          row => row[related.throughField.name][table.model.keyField().name]
        );
        return mapping._delete(connection, rows).then(() =>
          table._delete(connection, {
            [table.model.keyField().name]: values
          })
        );
      });
  }

  _disconnectThrough(
    connection: Connection,
    related: RelatedField,
    value: Value,
    args: Document[]
  ): Promise<any> {
    const mapping = this.db.table(related.throughField.model);
    return mapping._delete(connection, {
      [related.referencingField.name]: value,
      [related.throughField.name]: args
    });
  }

  append(data?: { [key: string]: any } | any[]): Record {
    const record = new Proxy(new Record(this), RecordProxy);
    Object.assign(record, data);
    const existing = this._mapGet(record);
    if (!existing) {
      this.recordList.push(record);
      this._mapPut(record);
      return record;
    }
    return existing;
  }

  clear() {
    this.recordList = [];
    this._initMap();
  }

  getDirtyCount(): number {
    let dirtyCount = 0;
    for (const record of this.recordList) {
      if (record.__dirty() && !record.__state.merged) {
        dirtyCount++;
      }
    }
    return dirtyCount;
  }

  json() {
    return this.recordList.map(record => record.__json());
  }

  _mapGet(record: Record): Record {
    let existing: Record;
    for (const uc of this.model.uniqueKeys) {
      const value = record.__valueOf(uc);
      if (value !== undefined) {
        const record = this.recordMap[uc.name()][value];
        if (existing !== record) {
          if (existing) throw Error(`Inconsistent unique constraint values`);
          existing = record;
        }
      }
    }
    return existing;
  }

  _mapPut(record: Record) {
    for (const uc of this.model.uniqueKeys) {
      const value = record.__valueOf(uc);
      if (value !== undefined) {
        this.recordMap[uc.name()][value] = record;
      }
    }
  }

  _initMap() {
    this.recordMap = this.model.uniqueKeys.reduce((map, uc) => {
      map[uc.name()] = {};
      return map;
    }, {});
  }
}

function _toCamel(value: Value, field: SimpleField): Value {
  if (/date|time/i.test(field.column.type)) {
    return new Date(value as string).toISOString();
  }
  return value;
}

export function _toSnake(value: Value, field: SimpleField): Value {
  if (value && /date|time/i.test(field.column.type)) {
    return new Date(value as any)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');
  }
  return value;
}

export function toDocument(row: Row, model: Model): Document {
  const result = {};
  for (const field of model.fields) {
    if (field instanceof SimpleField && row[field.column.name] !== undefined) {
      const value = _toCamel(row[field.column.name], field);
      if (field instanceof ForeignKeyField && value !== null) {
        result[field.name] = {
          [field.referencedField.model.keyField().name]: value
        };
      } else {
        result[field.name] = value;
      }
    }
  }
  return result;
}

function isEmpty(value: Value | Record | any) {
  if (value === undefined) {
    return true;
  }

  if (value instanceof Record) {
    while (value.__state.merged) {
      value = value.__state.merged;
    }
    return isEmpty(value.__primaryKey());
  }

  return false;
}

type FieldValue = Value | Record;

export class Record {
  __table: Table;
  __data: { [key: string]: FieldValue };
  __state: FlushState;

  constructor(table: Table) {
    this.__table = table;
    this.__data = {};
    this.__state = new FlushState();
  }

  get(name: string): FieldValue | undefined {
    return this.__data[name];
  }

  save(): Promise<any> {
    return this.__table.db.pool.getConnection().then(connection =>
      connection.transaction(() =>
        flushRecord(connection, this).then(result => {
          connection.release();
          return result;
        })
      )
    );
  }

  update(data: Row = {}): Promise<any> {
    for (const key in data) {
      this[key] = data[key];
    }
    this.__state.method = FlushMethod.UPDATE;
    return this.save();
  }

  delete(): Promise<any> {
    const filter = this.__table.model.getUniqueFields(this.__data);
    return this.__table.delete(filter);
  }

  __dirty(): boolean {
    return this.__state.dirty.size > 0;
  }

  __flushable(perfect?: boolean): boolean {
    if (this.__state.merged) {
      return false;
    }

    const data = this.__data;

    if (!this.__table.model.checkUniqueKey(data, isEmpty)) {
      return false;
    }

    if (this.__state.method === FlushMethod.DELETE) {
      return true;
    }

    let flushable = 0;

    this.__state.dirty.forEach(key => {
      if (!isEmpty(data[key])) {
        flushable++;
      }
    });

    return perfect ? flushable === this.__state.dirty.size : flushable > 0;
  }

  __fields(): Row {
    const fields = {};
    this.__state.dirty.forEach(key => {
      if (!isEmpty(this.__data[key])) {
        fields[key] = this.__getValue(key);
      }
    });
    return fields;
  }

  __remove_dirty(keys: string | string[]) {
    if (typeof keys === 'string') {
      this.__state.dirty.delete(keys);
    } else {
      for (const key of keys) {
        this.__state.dirty.delete(key);
      }
    }
  }

  __getValue(name: string): Value {
    if (this.__data[name] instanceof Record) {
      let parent = this.__data[name] as Record;
      while (parent.__state.merged) {
        parent = parent.__state.merged;
      }
      return parent.__primaryKey();
    }
    return this.__data[name] as Value;
  }

  __primaryKey(): Value {
    const name = this.__table.model.primaryKey.fields[0].name;
    const value = this.__data[name];
    if (value instanceof Record) {
      return value.__primaryKey();
    }
    return value;
  }

  __setPrimaryKey(value: Value) {
    const name = this.__table.model.primaryKey.fields[0].name;
    this.__data[name] = value;
  }

  __filter(): Row {
    const self = this;
    const data = Object.keys(this.__data).reduce(function(acc, cur, i) {
      acc[cur] = self.__getValue(cur);
      return acc;
    }, {});
    return this.__table.model.getUniqueFields(data);
  }

  __match(row: Document): boolean {
    const model = this.__table.model;
    const fields = this.__filter();
    for (const name in fields) {
      const lhs = model.valueOf(fields, name);
      const rhs = model.valueOf(row, name);
      const field = model.field(name) as SimpleField;
      if (_toSnake(lhs, field) != _toSnake(rhs, field)) {
        return false;
      }
    }
    return true;
  }

  __valueOf(uc: UniqueKey): string {
    const values = [];
    for (const field of uc.fields) {
      let value = this.__getValue(field.name);
      if (value === undefined) return undefined;
      if (field instanceof ForeignKeyField) {
        let key = field;
        while (!isValue(value)) {
          value = value[key.referencedField.name];
          key = key.referencedField as ForeignKeyField;
        }
      }
      values.push(value);
    }
    return JSON.stringify(values);
  }

  __merge() {
    let root = this.__state.merged;
    while (root.__state.merged) {
      root = root.__state.merged;
    }
    const self = this;
    this.__state.dirty.forEach(name => {
      root.__data[name] = self.__data[name];
      root.__state.dirty.add(name);
    });
  }

  __json() {
    const result = {};
    for (const field of this.__table.model.fields) {
      result[field.name] = this.__getValue(field.name);
    }
    return result;
  }
}

export function isValue(value): boolean {
  if (value === null) return true;

  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') {
    return true;
  }

  return value instanceof Date;
}
