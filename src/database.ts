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
} from './domain';

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

  table(name: string): Table {
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

  private _pair(name: string, value: Value): string {
    const field = this.model.field(name) as SimpleField;
    return this.escapeName(field) + '=' + this.escapeValue(field, value);
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
    let sql = `update ${this._name()} set`;

    const keys = Object.keys(data);
    for (let i = 0; i < keys.length; i++) {
      if (i > 0) {
        sql += ',';
      }
      sql += this._pair(keys[i], data[keys[i]] as Value);
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

  delete(model: Model, where?: Document | Document[]): Promise<any> {
    let sql = `delete from {this._name()}`;

    if (where) {
      sql += ` where ${this._where(where)}`;
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

export function rowToSnake(row: Row, model: Model): Row {
  const result = {};
  for (const key in row) {
    const field = model.field(key);
    if (field instanceof SimpleField) {
      result[field.column.name] = _toSnake(row[key], field);
    } else {
      result[key] = row[key];
    }
  }
  return result;
}

export function rowsToCamel(rows: Row[], model: Model): Row[] {
  return rows.map(row => toDocument(row, model));
}

export function rowsToSnake(rows: Row[], model: Model): Row[] {
  return rows.map(row => rowToSnake(row, model));
}
