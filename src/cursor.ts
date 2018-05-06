import { QueryBuilder } from './filter';
import { Model, SimpleField, UniqueKey, ForeignKeyField } from './model';
import { Table, Filter, Value, toDocument, _toSnake } from './database';
import { Connection } from './engine';

interface FieldInfo {
  alias: string;
  field: SimpleField;
  desc: boolean;
  value: Value;
}

function buildFilter(
  engine: Connection,
  fields: FieldInfo[],
  index: number
): string {
  const info = fields[index];
  const name = info.field.column.name;
  const lhs = `${engine.escapeId(info.alias)}.${engine.escapeId(name)}`;
  const rhs = engine.escape(_toSnake(info.value, info.field) + '');
  const where = `${lhs} ${info.desc ? '<' : '>'} ${rhs}`;

  if (index + 1 === fields.length) {
    return where;
  }

  const next = buildFilter(engine, fields, index + 1);

  return `${where} or (${lhs}=${rhs} and ${next})`;
}

export interface CursorQueryOptions {
  where?: Filter;
  orderBy?: string[];
  cursor?: string;
  limit?: number;
  before?: boolean;
}

export function cursorQuery(table: Table, options: CursorQueryOptions) {
  const model = table.model;

  let orderBy = model.primaryKey.fields.map(field => field.name);

  if (options.orderBy) {
    orderBy = [...options.orderBy, ...orderBy];
  }

  orderBy = matchUniqueKey(model, orderBy);

  return table
    .select('*', { ...options, orderBy }, builder => {
      if (options.cursor) {
        const values = decodeCursor(options.cursor);
        const fields = orderBy.map((entry, index) => {
          const [path, direction] = entry.split(/\s+/);
          const desc = direction && /^desc$/i.test(direction);
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
            value: values[index]
          };
        });
        return buildFilter(table.db.engine, fields, 0);
      }
      return null;
    })
    .then(rows => {
      const keys = orderBy.map(s => s.split(/\s+/)[0].replace(/\./g, '__'));
      return rows.map(row => ({
        node: toDocument(row, model),
        cursor: encodeCursor(keys.map(key => row[key]))
      }));
    });
}

export function encodeCursor(data) {
  return Buffer.from(JSON.stringify(data)).toString('base64');
}

export function decodeCursor(cursor) {
  return JSON.parse(Buffer.from(cursor, 'base64').toString());
}

export function matchUniqueKey(model: Model, spec: string[]): string[] {
  const names = spec.map(name => name.split(/\s+/)[0].split('.'));
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
          let model = (key as ForeignKeyField).referencedField.model;
          let field = model.field(names[index][i]);
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
    if (success) {
      return spec.slice(0, lastIndex + 1);
    }
  }
  return null;
}
