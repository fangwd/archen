export type Value = string | number | boolean | Date | null;

export type Document = {
  [key: string]: Value | Value[] | Document | Document[];
};

type _Filter = {
  [key: string]: Value | Value[] | RawQuery | _Filter | _Filter[];
};

export type Filter = _Filter | _Filter[];

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

import { Connection, Row } from './engine';
import { encodeFilter, QueryBuilder, RawQuery } from './filter';
import { toArray } from './misc';

import {
  RecordProxy,
  FlushState,
  FlushMethod,
  flushDatabase,
  flushRecord
} from './flush';

export interface DatabaseOptions {
  fieldSeparator: string;
  buildError: (table: Table, action: string, data: any, error: any) => string;
}

const DEFAULT_OPTIONS = {
  fieldSeparator: '-'
};

export class Database {
  schema: Schema;
  engine: Connection;
  tableMap: { [key: string]: Table } = {};
  tableList: Table[] = [];
  options: DatabaseOptions;

  constructor(
    schema: Schema,
    connection?: Connection,
    options?: DatabaseOptions
  ) {
    this.schema = schema;
    this.engine = connection;
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
    this.options = Object.assign({}, options, DEFAULT_OPTIONS);
  }

  table(name: string | Field | Model): Table {
    if (name instanceof Field) {
      name = name.model.name;
    } else if (name instanceof Model) {
      name = name.name;
    }
    return this.tableMap[name];
  }

  transaction(callback): Promise<Database> {
    return this.engine.transaction(callback);
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
    return flushDatabase(this);
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

  private _name(): string {
    return this.db.engine.escapeId(this.model.table.name);
  }

  private _where(filter: Filter) {
    return encodeFilter(filter, this.model, this.db.engine);
  }

  private _pair(name: string | SimpleField, value: Value): string {
    if (typeof name === 'string') {
      name = this.model.field(name) as SimpleField;
    }
    return this.escapeName(name) + '=' + this.escapeValue(name, value);
  }

  select(fields: string, options: SelectOptions = {}): Promise<Document[]> {
    let sql = new QueryBuilder(this.model, this.db.engine).select(
      fields,
      options.where,
      options.orderBy
    );

    if (options.limit !== undefined) {
      sql += ` limit ${parseInt(options.limit + '')}`;
    }

    if (options.offset !== undefined) {
      sql += ` offset ${parseInt(options.offset + '')}`;
    }

    return new Promise<Document[]>(resolve => {
      this.db.engine.query(sql).then(rows => {
        resolve(rows.map(row => toDocument(row, this.model)));
      });
    });
  }

  update(data: Document, filter?: Filter): Promise<any> {
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

    return this.db.engine.query(sql).catch(error => {
      if (typeof this.db.options.buildError === 'function') {
        error = this.db.options.buildError(this, 'UPDATE', data, error);
      }
      throw Error(error);
    });
  }

  insert(data: Row): Promise<any> {
    const keys = Object.keys(data);
    const name = keys.map(key => this.escapeName(key)).join(', ');
    const value = keys.map(key => this.escapeValue(key, data[key])).join(', ');
    const sql = `insert into ${this._name()} (${name}) values (${value})`;
    return this.db.engine.query(sql).catch(error => {
      if (typeof this.db.options.buildError === 'function') {
        error = this.db.options.buildError(this, 'INSERT', data, error);
      }
      throw Error(error);
    });
  }

  delete(filter?: Filter): Promise<any> {
    let sql = `delete from ${this._name()}`;

    if (filter) {
      sql += ` where ${this._where(filter)}`;
    }
    return this.db.engine.query(sql);
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
    return this.db.engine.escapeId(name);
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
    return this.db.engine.escape(_toSnake(value, field) + '');
  }

  get(key: Value | Filter): Promise<Document> {
    if (key === null || typeof key !== 'object') {
      key = {
        [this.model.keyField().name]: key
      };
    } else if (!this.model.checkUniqueKey(key)) {
      const msg = `Bad selector: ${JSON.stringify(key)}`;
      return Promise.reject(Error(msg));
    }
    return this.select('*', { where: key } as SelectOptions).then(
      rows => rows[0]
    );
  }

  // GraphQL mutations
  resolveParentFields(input: Document, filter?: Filter): Promise<Row> {
    const result: Row = {};
    const promises = [];
    const self = this;

    function _createPromise(field: ForeignKeyField, data: Document): void {
      const table = self.db.table(field.referencedField.model);
      const method = Object.keys(data)[0];
      let promise;
      switch (method) {
        case 'connect':
          promise = table.get(data[method] as Document);
          break;
        case 'create':
          promise = table.create(data[method] as Document);
          break;
        case 'update':
          {
            const where = { [field.relatedField.name]: filter };
            promise = table.modify(data[method] as Document, where);
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

  create(data: Document): Promise<Document> {
    // TODO: Don't allow inserting empty objects
    return this.resolveParentFields(data).then(row =>
      this.insert(row).then(id => {
        return this.updateChildFields(data, id).then(() => this.get(id));
      })
    );
  }

  upsert(data: Document, update?: Document): Promise<Document> {
    if (!this.model.checkUniqueKey(data)) {
      return Promise.reject(`Incomplete: ${JSON.stringify(data)}`);
    }

    const self = this;

    return this.resolveParentFields(data).then(row => {
      const uniqueFields = self.model.getUniqueFields(row);
      return self.get(uniqueFields).then(row => {
        if (!row) {
          return self.create(data);
        } else {
          if (update && Object.keys(update).length > 0) {
            return self.modify(update, uniqueFields);
          } else {
            return row;
          }
        }
      });
    });
  }

  modify(data: Document, filter: Filter): Promise<Document> {
    if (!this.model.checkUniqueKey(filter)) {
      return Promise.reject(`Bad filter: ${JSON.stringify(filter)}`);
    }

    const self = this;

    return this.resolveParentFields(data, filter).then(row => {
      return self.update(row, filter).then(() => {
        const where = Object.assign({}, filter);
        for (const key in where) {
          if (key in row) {
            where[key] = row[key];
          }
        }
        return self.get(where as Document).then(row => {
          if (row) {
            const id = row[this.model.keyField().name] as Value;
            return this.updateChildFields(data, id).then(() => row);
          } else {
            return Promise.resolve(row);
          }
        });
      });
    });
  }

  updateChildFields(data: Document, id: Value): Promise<void> {
    const promises = [];
    for (const key in data) {
      let field = this.model.field(key);
      if (field instanceof RelatedField) {
        promises.push(this.updateChildField(field, id, data[key] as Document));
      }
    }
    return Promise.all(promises).then(() => Promise.resolve());
  }

  updateChildField(
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
        return table.update({ [field.name]: null }, { [field.name]: id });
      } else {
        return table.delete({ [field.name]: id });
      }
    }
    for (const method in data) {
      const args = data[method] as Document[];
      if (method === 'connect') {
        if (related.throughField) {
          promises.push(this.connectThrough(related, id, args));
          continue;
        }
        // connect: [{parent: {id: 2}, name: 'Apple'}, ...]
        for (const arg of toArray(args)) {
          if (!table.model.checkUniqueKey(arg)) {
            return Promise.reject(`Bad filter (${table.model.name})`);
          }
          let promise;
          if (field.isUnique()) {
            promise = this._disconnectUnique(field, id).then(() =>
              table.update({ [field.name]: id }, args)
            );
          } else {
            promise = table.update({ [field.name]: id }, args);
          }
          promises.push(promise);
        }
      } else if (method === 'create') {
        if (related.throughField) {
          promises.push(this.createThrough(related, id, args));
          continue;
        }
        // create: [{parent: {id: 2}, name: 'Apple'}, ...]
        const docs = toArray(args).map(arg => ({ [field.name]: id, ...arg }));
        if (field.isUnique()) {
          promises.push(
            this._disconnectUnique(field, id).then(() => table.create(docs[0]))
          );
        } else {
          for (const doc of docs) {
            promises.push(table.create(doc));
          }
        }
      } else if (method === 'upsert') {
        if (related.throughField) {
          promises.push(this.upsertThrough(related, id, args));
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
          promises.push(table.upsert(create as Document, update as Document));
        }
      } else if (method === 'update') {
        if (related.throughField) {
          promises.push(this.updateThrough(related, id, args));
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
          promises.push(table.modify(data, filter));
        }
      } else if (method === 'delete') {
        if (related.throughField) {
          promises.push(this.deleteThrough(related, id, args));
          continue;
        }
        const filter = args.map(arg => ({
          ...(arg /*.where*/ as Document),
          [field.name]: id
        }));
        promises.push(table.delete(filter as Filter));
      } else if (method === 'disconnect') {
        if (related.throughField) {
          promises.push(this.disconnectThrough(related, id, args));
          continue;
        }
        const where = args.map(arg => ({ [field.name]: id, ...arg }));
        promises.push(table.update({ [field.name]: null }, where));
      } else {
        throw Error(`Unknown method: ${method}`);
      }
    }

    return Promise.all(promises).then(() => Promise.resolve());
  }

  _disconnectUnique(field: SimpleField, id: Value): Promise<any> {
    const table = this.db.table(field.model);
    return field.column.nullable
      ? table.update({ [field.name]: null }, { [field.name]: id })
      : table.delete({ [field.name]: id });
  }

  // Aggregate functions
  count(filter?: Filter): Promise<number> {
    let sql = `select count(1) as result from ${this._name()}`;

    if (filter) {
      sql += ` where ${this._where(filter)}`;
    }

    return new Promise<number>(resolve => {
      this.db.engine.query(sql).then(rows => {
        resolve(parseInt(rows[0].result));
      });
    });
  }

  connectThrough(
    related: RelatedField,
    value: Value,
    args: Document[]
  ): Promise<any> {
    const table = this.db.table(related.throughField.referencedField.model);
    const mapping = this.db.table(related.throughField.model);
    const promises = args.map(arg =>
      table.get(arg).then(row =>
        mapping.create({
          [related.referencingField.name]: value,
          [related.throughField.name]: row[table.model.keyField().name]
        })
      )
    );
    return Promise.all(promises);
  }

  createThrough(
    related: RelatedField,
    value: Value,
    args: Document[]
  ): Promise<any> {
    const table = this.db.table(related.throughField.referencedField.model);
    const mapping = this.db.table(related.throughField.model);
    const promises = args.map(arg =>
      table.create(arg).then(row =>
        mapping.create({
          [related.referencingField.name]: value,
          [related.throughField.name]: row[table.model.keyField().name]
        })
      )
    );
    return Promise.all(promises);
  }

  upsertThrough(
    related: RelatedField,
    value: Value,
    args: Document[]
  ): Promise<any> {
    const table = this.db.table(related.throughField.referencedField.model);
    const mapping = this.db.table(related.throughField.model);
    const promises = args.map(arg =>
      table.upsert(arg.create as Document, arg.update as Document).then(row =>
        mapping.upsert({
          [related.referencingField.name]: value,
          [related.throughField.name]: row[table.model.keyField().name]
        })
      )
    );
    return Promise.all(promises);
  }

  updateThrough(
    related: RelatedField,
    value: Value,
    args: Document[]
  ): Promise<any> {
    const table = this.db.table(related.throughField.referencedField.model);
    const mapping = this.db.table(related.throughField.model);
    const promises = args.map(arg => {
      const model = related.referencingField.model;
      const builder = new QueryBuilder(model, this.db.engine);
      const where = {
        [table.model.keyField().name + '_in']: new RawQuery(
          builder.select(related.throughField, {
            [related.referencingField.name]: value
          })
        ),
        ...(arg.where as object)
      };
      return table.modify(arg.data as Document, where);
    });
    return Promise.all(promises);
  }

  deleteThrough(
    related: RelatedField,
    value: Value,
    args: Document[]
  ): Promise<any> {
    const mapping = this.db.table(related.throughField.model);
    const table = this.db.table(related.throughField.referencedField.model);
    return mapping
      .select('*', {
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
        return mapping.delete(rows).then(() =>
          table.delete({
            [table.model.keyField().name]: values
          })
        );
      });
  }

  disconnectThrough(
    related: RelatedField,
    value: Value,
    args: Document[]
  ): Promise<any> {
    const mapping = this.db.table(related.throughField.model);
    return mapping.delete({
      [related.referencingField.name]: value,
      [related.throughField.name]: args
    });
  }

  append(data?: { [key: string]: any }): Record {
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
      const value = record.__valueOf(uc, this.db.options.fieldSeparator);
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
      const value = record.__valueOf(uc, this.db.options.fieldSeparator);
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

export function rowsToCamel(rows: Row[], model: Model): Row[] {
  return rows.map(row => toDocument(row, model));
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

export class Record {
  __table: Table;
  __data: Row;
  __state: FlushState;

  constructor(table: Table) {
    this.__table = table;
    this.__data = {};
    this.__state = new FlushState();
  }

  get(name: string): Value | undefined {
    return this.__data[name];
  }

  delete(): Promise<any> {
    const filter = this.__table.model.getUniqueFields(this.__data);
    return this.__table.delete(filter);
  }

  save(): Promise<any> {
    return flushRecord(this);
  }

  update(data: Row = {}): Promise<any> {
    for (const key in data) {
      this[key] = data[key];
    }
    this.__state.method = FlushMethod.UPDATE;
    return this.save();
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
      let parent = this.__data[name];
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
      const lhs = model.valueOf(fields[name], name);
      const rhs = model.valueOf(row[name] as Value, name);
      const field = model.field(name) as SimpleField;
      if (_toSnake(lhs, field) != _toSnake(rhs, field)) {
        return false;
      }
    }
    return true;
  }

  __valueOf(uc: UniqueKey, separator = '-'): string {
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
    return values.join(separator);
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
