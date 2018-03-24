import { Model, SimpleField } from './domain';

export type Value = string | number | boolean | Date | null;

export type Row = {
  [key: string]: Value;
};

export interface QueryArgs {
  [key: string]: Value | QueryArgs | QueryArgs[];
}

function _toCamel(value: Value, field: SimpleField): Value {
  if (/date|time/i.test(field.column.type)) {
    return new Date(value as string).toISOString();
  }
  return value;
}

function _toSnake(value: Value, field: SimpleField): Value {
  if (/date|time/i.test(field.column.type)) {
    return new Date(value as any)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');
  }
  return value;
}

export function rowToCamel(row: Row, model: Model): Row {
  const result = {};
  for (const field of model.fields) {
    if (field instanceof SimpleField) {
      if (row[field.column.name] !== undefined) {
        result[field.name] = _toCamel(row[field.column.name], field);
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
      result[field.name] = _toSnake(row[key], field);
    } else {
      result[key] = row[key];
    }
  }
  return result;
}

export function rowsToCamel(rows: Row[], model: Model): Row[] {
  return rows.map(row => rowToCamel(row, model));
}

export function rowsToSnake(rows: Row[], model: Model): Row[] {
  return rows.map(row => rowToSnake(row, model));
}

export function serialise(op, argv: any[]) {
  return new Promise(resolve => {
    const results = [];
    let next = 0;
    function _resolve() {
      if (next >= argv.length) {
        resolve(results);
      } else {
        const args = argv[next++];
        op(args).then(result => {
          results.push(result);
          _resolve();
        });
      }
    }
    _resolve();
  });
}
