import { Record, Value } from './database';
import { Row } from './engine';
import { resolve } from 'dns';

export enum FlushMethod {
  INSERT,
  UPDATE,
  DELETE
}

export class FlushState {
  method: FlushMethod = FlushMethod.INSERT;
  dirty: Set<string> = new Set();
}

export const RecordProxy = {
  set: function(record: Record, name: string, value: any) {
    if (!/^__/.test(name)) {
      const model = record.__table.model;
      const field = model.field(name);
      if (!field) {
        throw Error(`Invalid field: ${model.name}.${name}`);
      }
      // throw TypeError(), RangeError(), etc
      record.__data[name] = value;
      record.__state.dirty.add(name);
    } else {
      record[name] = value;
    }
    return true;
  },

  get: function(record: Record, name: string) {
    if (typeof name === 'string' && !/^__/.test(name)) {
      if (typeof record[name] !== 'function') {
        const model = record.__table.model;
        const field = model.field(name);
        return record.__data[name];
      }
    }
    return record[name];
  }
};

function flushable(value: Value | Record | any) {
  if (value === undefined) {
    return false;
  }

  if (value instanceof Record) {
    return flushable(value.__primaryKey());
  }

  return true;
}

class PersistContext {
  visited: Set<Record> = new Set();
}

function _persistRecord(record: Record): Promise<any> {
  const dirty = new Set();
  const row: Row = {};

  for (const key in record.__data) {
    if (flushable(record[key])) {
      row[key] = record.__getValue(key);
    } else {
      dirty.add(key);
    }
  }

  return record.__table.insert(row).then(id => {
    // NOTE: Assuming auto increment id; otherwise need get
    record.__setPrimaryKey(id);
    record.__state.dirty = dirty;
    return record;
  });
}

function resolveParentFields(
  record: Record,
  context: PersistContext
): Promise<any> {
  const promises: Promise<any>[] = [];
  for (const key in record.__data) {
    const value = record.__data[key];
    if (!flushable(value)) {
      if (value instanceof Record) {
        if (context.visited.has(value)) {
          return Promise.reject(value);
        } else {
          context.visited.add(this);
          promises.push(resolveParentFields(this, context));
        }
      }
    }
  }
  return Promise.all(promises).then(
    () => (record.__dirty() ? _persistRecord(record) : record)
  );
}

export function persistRecord(record: Record): Promise<any> {
  const context = new PersistContext();
  const promises: Promise<any>[] = [];
  for (const key in record.__data) {
    const value = record.__data[key];
    if (value instanceof Record) {
      promises.push(resolveParentFields(value, context));
    }
  }
  return Promise.all(promises).then(() => _persistRecord(record));
}
