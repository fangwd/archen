import { Database, Table, Record, Document, toDocument } from './database';

import { Connection, Row, Value } from './engine';
import { encodeFilter } from './filter';

import DataLoader = require('dataloader');
import { SimpleField } from './model';

export enum FlushMethod {
  INSERT,
  UPDATE,
  DELETE
}

export class FlushState {
  method: FlushMethod = FlushMethod.INSERT;
  dirty: Set<string> = new Set();
  deleted: boolean = false;
  merged?: Record;
  selected?: boolean;
  clone(): FlushState {
    const state = new FlushState();
    state.method = this.method;
    state.dirty = new Set(this.dirty);
    state.deleted = this.deleted;
    state.merged = undefined;
    state.selected = undefined;
    return state;
  }
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

  constructor(connection: Connection) {
    this.inserter = new DataLoader<Record, Record>((records: Record[]) =>
      Promise.all(records.map(record => _persist(connection, this, record)))
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

export function flushRecord(
  connection: Connection,
  record: Record
): Promise<any> {
  const store = new RecordStore(connection);

  return new Promise((resolve, reject) => {
    function __resolve() {
      const context = new FlushContext(store);
      collectParentFields(record, context, true);
      if (context.promises.length > 0) {
        Promise.all(context.promises).then(() => __resolve());
      } else {
        if (record.__flushable(false)) {
          _persist(connection, store, record).then(() => {
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
function _persist(
  connection: Connection,
  store: RecordStore,
  record: Record
): Promise<Record> {
  const method = record.__state.method;
  const model = record.__table.model;
  const filter = model.getUniqueFields(record.__data);

  if (method === FlushMethod.DELETE) {
    return record.__table.delete(filter).then(() => {
      record.__state.deleted = true;
      return record;
    });
  }

  const fields = record.__fields();

  if (method === FlushMethod.UPDATE) {
    return record.__table._update(connection, fields, filter).then(affected => {
      if (affected > 0) {
        record.__remove_dirty(Object.keys(fields));
        return record;
      }
      throw Error(`Row does not exist`);
    });
  }

  return new Promise((resolve, reject) => {
    function _insert() {
      record.__table
        ._insert(connection, fields)
        .then(id => {
          if (record.__primaryKey() === undefined) {
            record.__setPrimaryKey(id);
          }
          record.__remove_dirty(Object.keys(fields));
          record.__state.method = FlushMethod.UPDATE;
          resolve(record);
        })
        .catch(error => {
          if (!isIntegrityError(error)) return reject(error);
          record.__table._get(connection, filter).then(row => {
            if (row) {
              record.__remove_dirty(Object.keys(filter));
              if (!record.__dirty()) {
                resolve(record);
              } else {
                record.__table._update(connection, fields, filter).then(() => {
                  record.__remove_dirty(Object.keys(fields));
                  if (record.__primaryKey() === undefined) {
                    const value = row[model.primaryKey.fields[0].name];
                    record.__setPrimaryKey(value as Value);
                  }
                  resolve(record);
                });
              }
            }
          });
        });
    }
    _insert();
  });
}

function flushTable(
  connection: Connection,
  table: Table,
  perfect?: boolean
): Promise<number> {
  if (table.recordList.length === 0) {
    return Promise.resolve(0);
  }

  const states = [];

  for (let i = 0; i < table.recordList.length; i++) {
    const record = table.recordList[i];
    states.push({
      data: { ...record.__data },
      state: record.__state.clone()
    });
  }

  return _flushTable(connection, table, perfect).catch(error => {
    for (let i = 0; i < table.recordList.length; i++) {
      const record = table.recordList[i];
      const state = states[i];
      record.__data = { ...state.data };
      record.__state = state.state.clone();
    }
    throw error;
  });
}

function _flushTable(
  connection: Connection,
  table: Table,
  perfect: boolean
): Promise<number> {
  mergeRecords(table);

  const filter = [];

  for (const record of table.recordList) {
    if (
      record.__dirty() &&
      record.__flushable(perfect) &&
      !record.__state.selected
    ) {
      filter.push(record.__filter());
    }
  }

  const dialect = table.db.pool;
  const model = table.model;

  function _select(): Promise<any> {
    if (filter.length === 0) return Promise.resolve();
    const fields = model.fields.filter(field => field.uniqueKey);
    const columns = fields.map(field => (field as SimpleField).column.name);
    const expression = columns.map(dialect.escapeId).join(',');
    const from = dialect.escapeId(model.table.name);
    const where = encodeFilter(filter, table.model, dialect);
    const query = `select ${columns.join(',')} from ${from} where ${where}`;
    return connection.query(query).then(rows => {
      rows = rows.map(row => toDocument(row, table.model));
      for (const record of table.recordList) {
        if (!record.__dirty()) continue;
        for (const row of rows) {
          if (!record.__match(row)) continue;
          if (!record.__primaryKey()) {
            const value = row[model.keyField().name];
            record.__setPrimaryKey(value);
          }
          for (const name in row) {
            if (!record.__state.dirty.has(name)) continue;
            const lhs = model.valueOf(record.__data as Document, name);
            const rhs = model.valueOf(row, name);
            if (lhs === rhs) {
              record.__state.dirty.delete(name);
            }
          }
          if (record.__dirty()) {
            if (record.__state.method === FlushMethod.INSERT) {
              record.__state.method = FlushMethod.UPDATE;
            }
          }
          record.__state.selected = true;
        }
      }
      return table.recordList;
    });
  }

  let insertCount;
  let updateCount;

  function _insert() {
    const fields = model.fields.filter(
      field => field instanceof SimpleField && !field.column.autoIncrement
    );
    const names = fields.map(field => (field as SimpleField).column.name);
    const columns = names.map(dialect.escapeId).join(',');
    const into = dialect.escapeId(model.table.name);
    const values = [];
    const records: Record[] = [];
    for (const record of table.recordList) {
      if (!record.__dirty() || !record.__flushable(perfect)) continue;
      if (record.__state.method !== FlushMethod.INSERT) continue;
      const entry = fields.reduce((values, field) => {
        if (!(field as SimpleField).column.autoIncrement) {
          const value = record.__getValue(field.name);
          values.push(table.escapeValue(field as SimpleField, value));
          if (value !== undefined) {
            record.__remove_dirty(field.name);
          }
        }
        return values;
      }, []);
      values.push(`(${entry})`);
      records.push(record);
    }

    if ((insertCount = values.length) > 0) {
      const joined = values.join(', ');
      const query = `insert into ${into} (${columns}) values ${joined}`;
      return connection.query(query).then(id => {
        for (const record of records) {
          if (model.primaryKey.autoIncrement()) {
            record.__setPrimaryKey(id++);
          }
          record.__state.selected = true;
          record.__state.method = FlushMethod.UPDATE;
        }
        return records;
      });
    }
  }

  function _update() {
    const promises = [];
    for (const record of table.recordList) {
      if (!record.__dirty() || !record.__flushable(perfect)) continue;
      if (record.__state.method !== FlushMethod.UPDATE) continue;
      const fields = record.__fields();
      record.__remove_dirty(Object.keys(fields));
      promises.push(table._update(connection, fields, record.__filter()));
    }
    if ((updateCount = promises.length) > 0) {
      return Promise.all(promises);
    }
  }

  return _select()
    .then(() => _insert())
    .then(() => _update())
    .then(() => {
      return filter.length + insertCount + updateCount;
    });
}

function mergeRecords(table: Table) {
  const model = table.model;

  const map = model.uniqueKeys.reduce((map, uc) => {
    map[uc.name()] = {};
    return map;
  }, {});

  for (const record of table.recordList) {
    if (record.__state.merged) continue;
    for (const uc of model.uniqueKeys) {
      const value = record.__valueOf(uc);
      if (value === undefined) continue;
      const existing = map[uc.name()][value];
      if (existing) {
        if (!record.__state.merged) {
          record.__state.merged = existing;
        } else if (record.__state.merged !== existing) {
          throw Error(`Inconsistent`);
        }
      } else {
        map[uc.name()][value] = record;
      }
    }
    if (record.__state.merged) {
      record.__merge();
    }
  }
}

function flushDatabaseA(connection: Connection, db: Database) {
  return new Promise((resolve, reject) => {
    function _flush() {
      const promises = db.tableList.map(table =>
        flushTable(connection, table, true)
      );
      Promise.all(promises)
        .then(results => {
          if (results.reduce((a, b) => a + b, 0) === 0) {
            resolve();
          } else {
            _flush();
          }
        })
        .catch(error => reject(error));
    }
    _flush();
  });
}

export function flushDatabaseB(connection: Connection, db: Database) {
  return new Promise((resolve, reject) => {
    let waiting = 0;
    function _flush() {
      const promises = db.tableList.map(table => flushTable(connection, table));
      Promise.all(promises)
        .then(results => {
          const count = results.reduce((a, b) => a + b, 0);
          if (count === 0 && db.getDirtyCount() > 0) {
            if (waiting++) {
              throw Error('Circular references');
            }
          } else {
            waiting = 0;
          }
          if (db.getDirtyCount() > 0) {
            _flush();
          } else {
            resolve();
          }
        })
        .catch(error => reject(error));
    }
    _flush();
  });
}

export function flushDatabase(connection: Connection, db: Database) {
  return new Promise((resolve, reject) => {
    const _flush = () => {
      connection.transaction(() => {
        flushDatabaseA(connection, db)
          .then(() =>
            flushDatabaseB(connection, db).then(() => {
              connection.commit().then(() => {
                resolve();
              });
            })
          )
          .catch(error => {
            connection.rollback().then(() => {
              if (isIntegrityError(error)) {
                setTimeout(_flush, Math.random() * 1000);
              } else {
                reject(error);
              }
            });
          });
      });
    };
    _flush();
  });
}

function isIntegrityError(error) {
  return /\bDuplicate\b/i.test(error.message);
}
