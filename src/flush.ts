import { Record, Value } from './database';
import { Row } from './engine';

import DataLoader = require('dataloader');

export enum FlushMethod {
  INSERT,
  UPDATE,
  DELETE
}

export class FlushState {
  method: FlushMethod = FlushMethod.INSERT;
  dirty: Set<string> = new Set();
  deleted: boolean = false;
}

export const RecordProxy = {
  set: function(record: Record, name: string, value: any) {
    if (!/^__/.test(name)) {
      if (value === undefined) {
        throw Error(`Assigning undefined to ${name}`);
      }
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

class FlushContext {
  store: RecordStore;
  visited: Set<Record> = new Set();
  promises = [];

  constructor(store: RecordStore) {
    this.store = store;
  }
}

export class RecordStore {
  inserter: DataLoader<Record, Record>;
  counter: number = 0;

  constructor() {
    this.inserter = new DataLoader<Record, Record>((records: Record[]) =>
      Promise.all(records.map(record => _persist(record)))
    );
  }
}

function collectParentFields(
  record: Record,
  context: FlushContext,
  perfect: boolean
) {
  if (!record.__dirty() || context.visited.has(record)) return;

  context.visited.add(record);

  record.__state.dirty.forEach(key => {
    const value = record.__data[key];
    if (value instanceof Record) {
      if (value.__primaryKey() === undefined) {
        if (value.__flushable(perfect)) {
          // assert value.__state.method === FlushMethod.INSERT
          const promise = context.store.inserter.load(value);
          context.promises.push(promise);
        } else {
          collectParentFields(value, context, perfect);
        }
      }
    }
  });
}

export function flushRecord(record: Record): Promise<any> {
  const store = new RecordStore();

  return new Promise((resolve, reject) => {
    function __resolve() {
      const context = new FlushContext(store);
      collectParentFields(record, context, true);
      if (context.promises.length > 0) {
        Promise.all(context.promises).then(() => __resolve());
      } else {
        if (record.__flushable(false)) {
          _persist(record).then(() => {
            if (!record.__dirty()) {
              resolve(record);
            } else {
              __resolve();
            }
          });
        } else {
          const context = new FlushContext(store);
          collectParentFields(record, context, false);
          if (context.promises.length > 0) {
            Promise.all(context.promises).then(() => __resolve());
          } else {
            reject(Error('Loops in record fields'));
          }
        }
      }
    }

    __resolve();
  });
}

/**
 * Flushes a *flushable* record to disk, updating its dirty fields or setting
 * __state.deleted to true after.
 *
 * @param record Record to be flushed to disk
 */
function _persist(record: Record): Promise<Record> {
  const method = record.__state.method;
  const model = record.__table.model;
  const fields = record.__fields();

  if (method === FlushMethod.INSERT) {
    return record.__table.insert(fields).then(id => {
      if (record.__primaryKey() === undefined) {
        record.__setPrimaryKey(id);
      }
      record.__remove_dirty(Object.keys(fields));
      record.__state.method = FlushMethod.UPDATE;
      return record;
    });
  }

  const filter = model.getUniqueFields(record.__data);

  if (method === FlushMethod.DELETE) {
    return record.__table.delete(filter).then(() => {
      record.__state.deleted = true;
      return record;
    });
  }

  return record.__table.update(fields, filter).then(() => {
    record.__remove_dirty(Object.keys(fields));
    return record;
  });
}
