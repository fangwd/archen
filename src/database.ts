export type Value = string | number | boolean | Date | null;

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
  RelatedField
} from './model';

import { Connection, Row } from './engine';
import { encodeFilter } from './filter';

export class Database {
  schema: Schema;
  engine: Connection;
  tables: { [key: string]: Table } = {};

  constructor(schema: Schema, connection: Connection) {
    this.schema = schema;
    this.engine = connection;
    for (const model of schema.models) {
      const table = new Table(this, model);
      this.tables[model.name] = table;
      this.tables[model.table.name] = table;
    }
  }

  table(name: string | Field | Model): Table {
    if (name instanceof Field) {
      name = name.model.name;
    } else if (name instanceof Model) {
      name = name.name;
    }
    return this.tables[name];
  }
}

interface SelectOptions {
  where?: Filter;
  offset?: number;
  limit?: number;
  orderBy?: string;
}

export class Table {
  db: Database;
  model: Model;

  constructor(db: Database, model: Model) {
    this.db = db;
    this.model = model;
  }

  private _name(): string {
    return this.db.engine.escapeId(this.model.table.name);
  }

  private _where(filter: Filter) {
    return encodeFilter(filter, this.model);
  }

  private _pair(name: string | SimpleField, value: Value): string {
    if (typeof name === 'string') {
      name = this.model.field(name) as SimpleField;
    }
    return this.escapeName(name) + '=' + this.escapeValue(name, value);
  }

  select(
    fields: string | string[],
    options?: SelectOptions
  ): Promise<Document[]> {
    if (Array.isArray(fields)) {
      fields = fields.map(name => this.escapeName(name));
    } else {
      fields = [this.escapeName(fields)];
    }

    let sql = `select ${fields.join(', ')} from ${this._name()}`;

    if (options) {
      if (options.where) {
        sql += ` where ${this._where(options.where)}`;
      }
      if (options.orderBy) {
        // FIXME: name mapping/escaping
        sql += ` order by ${options.orderBy}`;
      }
      if (options.limit !== undefined) {
        sql += ` limit ${options.limit}`;
      }
      if (options.offset !== undefined) {
        sql += ` offset ${options.offset}`;
      }
    }

    return new Promise<Document[]>(resolve => {
      this.db.engine.query(sql).then(rows => {
        resolve(rows.map(row => toDocument(row, this.model)));
      });
    });
  }

  update(data: Document, filter?: Filter): Promise<any> {
    if (Object.keys(data).length === 0) {
      return Promise.resolve();
    }

    let sql = `update ${this._name()} set`;

    const keys = Object.keys(data);
    for (let i = 0; i < keys.length; i++) {
      const field = this.model.field(keys[i]);
      if (field instanceof SimpleField) {
        if (i > 0) {
          sql += ',';
        }
        sql += this._pair(field, data[keys[i]] as Value);
      }
    }

    if (filter) {
      sql += ` where ${this._where(filter)}`;
    }

    return this.db.engine.query(sql);
  }

  insert(data: Row): Promise<any> {
    const keys = Object.keys(data);
    const name = keys.map(key => this.escapeName(key)).join(', ');
    const value = keys.map(key => this.escapeValue(key, data[key])).join(', ');
    const sql = `insert into ${this._name()} (${name}) values (${value})`;
    return this.db.engine.query(sql);
  }

  delete(filter: Filter): Promise<any> {
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
    if (value === null) {
      return 'null';
    }
    return this.db.engine.escape(value + '');
  }

  get(key: Value | Document): Promise<Document> {
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
  resolveParentFields(input: Document): Promise<Row> {
    const result: Row = {};
    const promises = [];
    const self = this;

    function _createPromise(field: ForeignKeyField, data: Document): void {
      const table = self.db.table(field.referencedField.model);
      const method = Object.keys(data)[0];
      let promise = (method === 'connect'
        ? table.get(data[method] as Document)
        : table.create(data[method] as Document)
      ).then(row => {
        result[field.name] = row
          ? row[field.referencedField.model.keyField().name]
          : null;
        return row;
      });
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
            return self.updateOne(update, uniqueFields);
          } else {
            return row;
          }
        }
      });
    });
  }

  updateOne(data: Document, filter: Filter): Promise<Document> {
    if (!this.model.checkUniqueKey(filter)) {
      return Promise.reject(`Bad filter: ${JSON.stringify(filter)}`);
    }

    const self = this;

    return this.resolveParentFields(data).then(row =>
      self.update(row, filter).then(() => {
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
      })
    );
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
    if (!field) throw Error(related.name + ' the related');
    const table = this.db.table(field.model);
    for (const method in data) {
      const args = data[method] as Document[];
      if (method === 'connect') {
        if (related.throughField) {
          promises.push(this.connectThrough(related, id, args));
          continue;
        }
        // connect: [{parent: {id: 2}, name: 'Apple'}, ...]
        for (const arg of args) {
          if (!table.model.checkUniqueKey(arg)) {
            return Promise.reject(`Bad filter (${table.model.name})`);
          }
          promises.push(table.update({ [field.name]: id }, args));
        }
      } else if (method === 'create') {
        if (related.throughField) {
          promises.push(this.createThrough(related, id, args));
          continue;
        }
        // create: [{parent: {id: 2}, name: 'Apple'}, ...]
        const docs = args.map(arg => ({ [field.name]: id, ...arg }));
        for (const doc of docs) {
          promises.push(table.create(doc));
        }
      } else if (method === 'upsert') {
        if (related.throughField) {
          promises.push(this.upsertThrough(related, id, args));
          continue;
        }
        const rows = [];
        for (const arg of args) {
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
        const rows = args.map(arg => ({
          data: arg.data,
          where: { ...(arg.where as Document), [field.name]: id }
        }));
        for (const arg of args) {
          const data = arg.data as Document;
          const filter = {
            [field.name]: id,
            ...((arg.where || {}) as Document)
          };
          promises.push(table.updateOne(data, filter));
        }
      } else if (method === 'delete') {
        const filter = args.map(arg => ({
          ...(arg.where as Document),
          [field.name]: id
        }));
        promises.push(table.delete(filter as Filter));
      } else if (method === 'disconnect') {
        const where = args.map(arg => ({ [field.name]: id, ...arg }));
        promises.push(table.update({ [field.name]: null }, where));
      } else if (method === 'set') {
        promises.push(
          table.delete({ [field.name]: id }).then(() =>
            table.updateChildField(related, id, {
              create: data[method] as Document
            })
          )
        );
      } else {
        throw Error(`Unknown method: ${method}`);
      }
    }

    return Promise.all(promises).then(() => Promise.resolve());
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
}

function _toCamel(value: Value, field: SimpleField): Value {
  if (/date|time/i.test(field.column.type)) {
    return new Date(value as string).toISOString();
  }
  return value;
}

export function _toSnake(value: Value, field: SimpleField): Value {
  if (/date|time/i.test(field.column.type)) {
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
      if (field instanceof ForeignKeyField) {
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
