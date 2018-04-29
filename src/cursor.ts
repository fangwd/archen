import { QueryBuilder } from './filter';
import { Model, SimpleField, UniqueKey, ForeignKeyField } from './model';
import { Table, Filter, Value, toDocument } from './database';
import { Connection } from './engine';

interface FieldInfo {
  alias: string;

  // Field name, e.g. quantity, user__email
  name: string;

  // Ascending/Descending
  desc: boolean;

  // Value in the last row retrieved
  value: Value;
}

// Assuming last n fields uniquely identify a row
function buildFilter(
  engine: Connection,
  fields: FieldInfo[],
  index: number
): string {
  const field = fields[index];

  const lhs = `${engine.escapeId(field.alias)}.${engine.escapeId(field.name)}`;
  const rhs = engine.escape(field.value + '');

  const where = `${lhs} ${field.desc ? '<' : '>'} ${rhs}`;

  if (index + 1 === fields.length) {
    return where;
  }

  const next = buildFilter(engine, fields, index + 1);

  return `${where} OR (${lhs} = ${rhs} AND ${next})`;
}

export interface CursorQueryOptions {
  where?: Filter;
  orderBy?: string[];
  cursor?: string;
  limit?: number;
  before?: boolean;
}

function splitAliasName(aliasMap, path) {
  const match = /^(.+)\.([^\.]+)$/.exec(path);
  return match ? [aliasMap[match[1]].name, match[2]] : [null, path];
}

export function cursorQuery(table: Table, options: CursorQueryOptions) {
  const model = table.model;

  let orderBy = model.primaryKey.fields.map(field => field.name);

  if (options.orderBy) {
    orderBy = [...options.orderBy, ...orderBy];
  }

  orderBy = matchUniqueKey(model, orderBy);

  const builder = new QueryBuilder(table.model, table.db.engine);
  const query = builder._select('*', options.where, orderBy);

  let sql = `select ${query.fields} from ${query.tables}`;

  let whered = false;

  if (options.cursor) {
    const values = decodeCursor(options.cursor);
    const fields = orderBy.map((entry, index) => {
      let [path, direction] = entry.split(/\s+/);
      let desc = direction && /^desc$/i.test(direction);
      const [alias, name] = splitAliasName(builder.context.aliasMap, path);
      // TODO: Replace "name" with "field" to handle types properly
      return {
        alias: alias || model.table.name,
        name,
        desc,
        value: values[index]
      };
    });
    sql += ' where ' + buildFilter(table.db.engine, fields, 0);
    whered = true;
  }

  if (query.where) {
    if (!whered) sql += ' where ';
    sql += query.where;
  }

  if (query.orderBy) {
    sql += ` order by ${query.orderBy}`;
  }

  if (options.limit) {
    sql += ` limit ${parseInt(options.limit + '')}`;
  }

  return table.db.engine.query(sql).then(rows => {
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
