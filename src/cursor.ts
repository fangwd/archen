import {  Filter, Table } from 'sqlex';
import { DialectEncoder } from 'sqlex/dist/engine';
import { ForeignKeyField, Model, SimpleField } from 'sqlex/dist/schema';
import { Value } from 'sqlex/dist/types';
import { toCamelCase } from 'sqlex/dist/utils';

interface FieldInfo {
  alias: string;
  field: SimpleField;
  desc: boolean;
  value: Value;
}

function buildFilter(
  dialect: DialectEncoder,
  fields: FieldInfo[],
  index: number
): string {
  const info = fields[index];
  const name = info.field.column.name;

  const col = `${dialect.escapeId(info.alias)}.${dialect.escapeId(name)}`;
  const val = escapeFieldValue(dialect, info.field, info.value);
  let where;
  if (info.desc) {
    if (info.value !== null)
      where = `${col} is null or ${col} < ${val}`;

  } else
    if (info.value === null)
      where = `${col} is not null`;
     else
      where = `${col} > ${val}`;

  if (index + 1 === fields.length)
    return where;

  const next = buildFilter(dialect, fields, index + 1);
  const equal = info.value === null ? `${col} is null` : `${col}=${val}`;

  return where ? `${where} or (${equal} and ${next})` : `${equal} and ${next}`;
}

export interface CursorQueryOptions {
  where?: Filter;
  orderBy?: string[];
  cursor?: string;
  limit?: number;
  before?: boolean;
  withTotal?: boolean;
}

export function cursorQuery(table: Table, options: CursorQueryOptions) {
  const model = table.model;

  let desc = '';
  if (options.orderBy) {
    const name = options.orderBy[options.orderBy.length - 1];
    if (name[0] === '-')
      desc = '-';

  }

  let orderBy = model.primaryKey.fields.map(field => desc + field.name);

  if (options.orderBy)
    orderBy = [...options.orderBy, ...orderBy];

  orderBy = matchUniqueKey(model, orderBy);

  const builder = function(builder) {
    if (options.cursor) {
      const values = decodeCursor(options.cursor);
      const fields = orderBy.map((entry, index) => {
        const [path, desc] =
          entry[0] === '-' ? [entry.substr(1), true] : [entry, false];
        const match = /^(.+)\.([^\.]+)$/.exec(path);
        let alias, field;
        if (match) {
          const entry = builder.context.aliasMap[match[1]];
          alias = entry.name;
          field = entry.model.field(match[2]);
        } else {
          alias = model.table.name;
          field = model.field(path);
        }
        return {
          alias,
          field,
          desc,
          value: values[index],
        };
      });
      return buildFilter(table.db.pool, fields, 0);
    }
    return null;
  };

  const selectOptions = { ...options, orderBy };

  const promises: Promise<any>[] = [
    table.select('*', selectOptions, builder).then(rows => {
      const keys = orderBy.map(s => {
        const name = s.replace(/^-/, '');
        return name.indexOf('.') === -1
          ? toCamelCase(name)
          : name.split('.')
      });
      return rows.map(row => {
        const cursor = [];
        for (const key of keys) {
          if (typeof key === 'string') {
            cursor.push(row[key])
          }
          else {
            let value: any = row;
            for (let i = 0; i < key.length; i++) {
              value = value[key[i]]
            }
            cursor.push(value);
          }
        }
        row.__cursor = encodeCursor(cursor);
        return row;
      });
    }),
  ];

  if (options.withTotal)
    promises.push(table.count(selectOptions.where));

  return Promise.all(promises).then(result => ({
    rows: result[0],
    totalCount: result[1],
  }));
}

export function encodeCursor(data) {
  return Buffer.from(JSON.stringify(data)).toString('base64');
}

export function decodeCursor(cursor) {
  return JSON.parse(Buffer.from(cursor, 'base64').toString());
}

export function matchUniqueKey(model: Model, spec: string[]): string[] {
  const names = spec.map(name => name.replace(/^-/, '').split('.'));
  const fields = names.map(name => name[0]);
  for (const uniqueKey of model.uniqueKeys) {
    let success = true;
    let lastIndex = 0;
    for (const field of uniqueKey.fields) {
      const index = fields.indexOf(field.name);
      if (index === -1) {
        success = false;
        break;
      }
      if (names[index].length > 1) {
        let key = field as ForeignKeyField;
        for (let i = 1; i < names[index].length; i++) {
          const model = (key ).referencedField.model;
          const field = model.field(names[index][i]);
          if (!field.isUnique()) {
            success = false;
            break;
          }
          key = field as ForeignKeyField;
        }
        if (!success) break;
      }
      lastIndex = lastIndex < index ? index : lastIndex;
    }
    if (success)
      return spec.slice(0, lastIndex + 1);

  }
  return null;
}

function escapeFieldValue( dialect: DialectEncoder, field:SimpleField,  value: string | number | boolean | Date): string{
      if (/int|float|double|number/i.test(field.column.type))
          return +(value as number) + '';

        if (/date|time/i.test(field.column.type))
          return dialect.escapeDate(new Date(value as string));

        return dialect.escape(value as string);
}

