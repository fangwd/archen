const DataLoader = require('dataloader');
const { Column } = require('./model');

class Loader {
  constructor(schema, db) {
    this.db = db;
    this.queryLoader = createQueryLoader(db);
    this.loaders = {};
    this.schema = schema;
    for (const table of this.schema.tables) {
      const loaders = {};
      for (const index of table.indexes) {
        if (index.primaryKey || index.unique) {
          if (index.columns.length == 1) {
            const column = table.column(index.columns[0]);
            loaders[column.name] = this._createLoader(column);
          }
        }
      }
      for (const column of table.columns) {
        if (column.references && !loaders[column.name]) {
          loaders[column.name] = this._createLoader(column);
        }
      }
      this.loaders[table.name] = loaders;
    }
  }

  _createLoader(column) {
    const me = this;
    const loader = new DataLoader(keys => {
      return new Promise((resolve, reject) => {
        me.db
          .table(column.table.name)
          .whereIn(column._name, keys)
          .then(result => {
            const rows = column.table.mapFrom(result);
            const loaders = me.loaders[column.name];
            for (const row of rows) {
              for (const columnName in loaders) {
                if (
                  columnName != column.name &&
                  loaders[columnName].column.unique
                ) {
                  loaders[columnName].loader.prime(row[columnName], row);
                }
              }
            }
            if (column.unique) {
              resolve(
                keys.map(key => rows.find(row => row[column.name] === key))
              );
            } else {
              resolve(
                keys.map(key => rows.filter(row => row[column.name] === key))
              );
            }
          });
      });
    });
    return { column, loader };
  }

  query(table, args) {
    const query = buildQuery(this.db, table, args);
    const me = this;
    return this.queryLoader.load(query.toString()).then(rows => {
      const loaders = me.loaders[table.name];
      for (const row of rows) {
        for (const columnName in loaders) {
          if (loaders[columnName].column.unique) {
            loaders[columnName].loader.prime(row[columnName], row);
          }
        }
      }
      return rows;
    });
  }

  load(column, value) {
    const loader = this.loaders[column.table.name][column.name].loader;
    return loader.load(value);
  }

  create(table, args) {
    return this.db.transaction(trx => createRow(trx, table, args.data));
  }

  update(table, args) {
    return this.db.transaction(trx => updateRow(trx, table, args));
  }

  upsert(table, args) {
    const me = this;
    return new Promise(resolve => {
      upsert(this.db, table, args).then(() => {
        const where = table.getUniqueFields(args.create);
        me.query(table, { where }).then(rows => resolve(rows[0]));
      });
    });
  }

  delete(table, args) {
    const where = firstOf(args.where);
    if (!where) {
      return Error('Empty where.');
    }
    const me = this;
    return new Promise(resolve => {
      me.query(table, { where }).then(rows => {
        const query = this.db(table.name);
        const builder = new Builder(this.db, table, true);
        query.where(builder.buildWhere(where));
        query
          .del()
          .then(() => resolve(rows[0]))
          .catch(e => resolve(Error(e.code)));
      });
    });
  }
}

function createQueryLoader(db) {
  const loader = new DataLoader(
    queries =>
      new Promise(resolve => {
        const makePromise = (query, index) =>
          new Promise(resolve => {
            db.raw(query).then(response => resolve({ index, response }));
          });
        const promises = queries.map((query, index) =>
          makePromise(query, index)
        );
        Promise.all(promises).then(responses => {
          const results = [];
          if (/mysql/i.test(db.client.dialect)) {
            responses.forEach(r => (results[r.index] = r.response[0]));
          }
          else {
            // sqlite3
            responses.forEach(r => (results[r.index] = r.response));
          }
          resolve(results);
        });
      }),
    { cache: false }
  );
  return loader;
}

class Builder {
  constructor(db, table, unique) {
    if (db instanceof Builder) {
      this.db = db.db;
      this.context = db.context;
    } else {
      this.db = db;
      this.context = { counter: 0, map: {} };
    }
    this.table = table;
    this.number = this.context.counter++;
    this.unique = unique;
  }

  select() {
    return this.db.select(this.scope()).from(this.as());
  }

  scope(name) {
    if (name instanceof Column) {
      name = name._name;
    }
    name = name || '*';
    return this.unique ? name : `t${this.number}.${name}`;
  }

  as(table) {
    table = table || this.table;
    return this.unique ? table.name : `${table.name} as t${this.number}`;
  }

  buildWhere(args, level = 0) {
    const me = this;
    return function() {
      for (const key in args) {
        const [name, op] = key.split(/_/); // __
        if (op) {
          name = me.table.column(name)._name;
        }
        const value = args[key];
        switch (op) {
          case 'lt':
            this.where(me.scope(name), '<', value);
            break;
          case 'le':
            this.where(me.scope(name), '<=', value);
            break;
          case 'ge':
            this.where(me.scope(name), '>=', value);
            break;
          case 'gt':
            this.where(me.scope(name), '>', value);
            break;
          case 'ne':
            this.where(me.scope(name), '!=', value);
            break;
          case 'like':
            this.where(me.scope(name), 'like', value);
            break;
          case 'in':
            this.whereIn(me.scope(name), value);
            break;
          case 'is_null':
            if (value) this.whereNull(me.scope(name));
            else this.whereNotNull(me.scope(name));
            break;
          case 'some':
            this.whereExists(me.buildQuery(name, value));
            break;
          case 'none':
            this.whereNotExists(me.buildQuery(name, value));
            break;
          default:
            if (!op) {
              if (name === 'AND') {
                this.andWhere(me.joinWhere(value, name, level));
              } else if (name === 'OR') {
                this.orWhere(me.joinWhere(value, name, level));
              } else if (name === 'NOT') {
                this.whereNot(me.joinWhere(value, name, level));
              } else {
                if (value !== null && typeof value === 'object') {
                  const column = me.table.foreignKey(name);
                  if (!column) {
                    const error = Error(`${me.table.name} ${name}`);
                    throw error;
                  }
                  const builder = new Builder(me, column.references.table);
                  builder.number = me.context.map[level][name];
                  this.where(builder.buildWhere(value, level + 1));
                } else {
                  this.where(me.scope(name), value);
                }
              }
            } else {
              throw `Unknown comparison operator: ${op}`;
            }
        }
      }
    };
  }

  joinWhere(args, op, level) {
    const me = this;
    return function() {
      for (const arg of args) {
        if (op === '_and') {
          this.where(me.buildWhere(arg, level));
        } else {
          this.orWhere(me.buildWhere(arg, level), args);
        }
      }
    };
  }

  join(query, args, level = 0) {
    for (const key in args) {
      const [name, op] = key.split(/_/); // __
      const value = args[key];
      if (!op && !/^_(and|or|not)$/i.test(name)) {
        if (value !== null && typeof value === 'object') {
          const table = this.table.foreignKey(name).references.table;
          const builder = new Builder(this, table);
          const left = this.scope(this.table.column(table));
          const right = builder.scope(table.primaryKey);
          query.join(builder.as(table), left, right);
          this.context.map[level] = this.context.map[level] || {};
          this.context.map[level][name] = builder.number;
          builder.join(query, value, level + 1);
        }
      }
    }
  }

  buildQuery(name, args) {
    const column = this.table.relatedKey(name);
    const builder = new Builder(this, column.table);
    const left = builder.scope(column);
    const right = this.scope(this.table.primaryKey);
    const query = builder.select();
    builder.join(query, args);
    builder.reset(column.table);
    query.where(builder.buildWhere(args));
    query.whereRaw(`${left}=${right}`);
    return query;
  }

  reset(table) {
    this.table = table;
    this.context.counter = 0;
    this.number = this.context.counter++;
  }
}

function buildQuery(db, table, args) {
  const builder = new Builder(db, table);
  const query = builder.select();

  if (args.where) {
    builder.join(query, args.where);
    builder.reset(table);
    query.where(builder.buildWhere(args.where));
  }

  if (args.limit !== undefined) {
    query.limit(args.limit);
  }

  if (args.offset !== undefined) {
    query.offset(args.offset);
  }

  if (args.orderBy !== undefined) {
    query.orderBy(args.orderBy);
  }

  return query.toString();
}

function firstOf(obj) {
  const keys = Object.keys(obj);
  if (keys.length > 0) {
    return { [keys[0]]: obj[keys[0]] };
  }
}

function upsert(db, table, { create, update }) {
  const insert = db(table.name).insert(create);
  const updateFields = update;
  update = db.queryBuilder().update(update);
  if (/mysql/i.test(db.client.dialect)) {
    update = update.toString().replace(/^\s*update\s+set/i, 'update');
    return db.raw('? on duplicate key ' + update, [insert]).then(res => {
      let fields = Object.assign({}, create);
      if (res[0].affectedRows > 1) {
        // 1: row is inserted as a new row, 2: an existing row is updated
        Object.assign(fields, updateFields);
      }
      return selectRow(db, table, table.getUniqueFields(fields));
    });
  } else {
    // Postgres: return db.raw('? on conflict (??) do ?', [insert, update]);
    return Promise.reject('Not supported.');
  }
}

module.exports = { Loader };

function resolveFields(db, table, args) {
  const result = {},
    todos = [],
    patches = [];

  for (const key in args) {
    let column = table.column(key);
    if (column) {
      result[key] = args[key];
    } else if ((column = table.foreignKey(key))) {
      todos.push({ column, args: args[key] });
    } else if ((column = table.relatedKey(key))) {
      patches.push({ column, args: args[key] });
    } else {
      const error = `Unknown field '${table.name}.${key}'`;
      return Promise.reject(Error(error));
    }
  }

  return new Promise(resolve => {
    let next = 0;
    function _resolve() {
      if (next >= todos.length) {
        resolve([result, patches]);
      } else {
        const { column, args } = todos[next++];
        if (Array.isArray(args)) {
          throw Error('Not implemented (array)!');
        } else {
          const key = Object.keys(args)[0];
          if (key === 'connect') {
            selectRow(db, column.references.table, args[key]).then(row => {
              if (!row) {
                throw Error('Object does not exist');
              } else {
                result[column.name] = row[Object.keys(row)[0]];
                _resolve();
              }
            });
          } else {
            if (key !== 'create') throw Error('Unknown: ' + key);
            createRow(db, column.references.table, args.create).then(id => {
              result[column.name] = id;
              _resolve();
            });
          }
        }
      }
    }
    _resolve();
  });
}

function createRow(db, table, args) {
  return new Promise((resolve, reject) => {
    resolveFields(db, table, args)
      .then(result => {
        const [data, todos] = result;
        db(table.name)
          .insert(data)
          .then(id => {
            if (Array.isArray(id)) id = id[0];
            resolveRelatedFields(db, id, todos).then(() => {
              selectRow(db, table, { [table.primaryKey.name]: id }, '*').then(
                row => {
                  resolve(row);
                }
              );
            });
          })
          .catch(reject);
      })
      .catch(reject);
  });
}

function updateRow(db, table, args) {
  const where = new Builder(db, table, true).buildWhere(args.where);
  return new Promise((resolve, reject) => {
    resolveFields(db, table, args.data)
      .then(result => {
        const [data, todos] = result;
        return db(table.name)
          .update(data)
          .where(where)
          .then(() => {
            return selectRow(db, table, where, '*').then(row => {
              if (!row) return reject(new Error('Not found.'));
              const id = row[table.primaryKey.name];
              return resolveRelatedFields(db, id, todos).then(() => {
                resolve(row);
              });
            });
          });
      })
      .catch(reject);
  });
}

function selectRow(db, table, where, columns) {
  if (!columns) {
    if (table.primaryKey instanceof Column) {
      columns = table.primaryKey.name;
    } else {
      columns = table.primaryKey.columns;
    }
  }
  return new Promise(resolve => {
    db
      .select(columns)
      .from(table.name)
      .where(function() {
        if (Array.isArray(where)) {
          for (const w of where) {
            const k = Object.keys(w);
            if (k.length === 1 && w[k[0]] && typeof w[k[0]] === 'object') {
              this.orWhere(w[k[0]]);
            } else {
              this.orWhere(w);
            }
          }
        } else {
          this.where(where);
        }
      })
      .then(rows => {
        resolve(Array.isArray(where) ? rows : rows[0]);
      });
  });
}

function resolveRelatedFields(db, id, todos) {
  const result = [];
  return new Promise((resolve, reject) => {
    let next = 0;
    function _resolve() {
      if (next >= todos.length) {
        resolve(id);
      } else {
        const { column, args } = todos[next++];
        resolveRelatedField(db, column, id, args)
          .then(_resolve)
          .catch(reject);
      }
    }
    _resolve();
  });
}

function resolveRelatedField(db, column, id, args) {
  const keys = Object.keys(args);
  return new Promise((resolve, reject) => {
    let next = 0;
    function _resolve() {
      if (next >= keys.length) {
        resolve();
      } else {
        const key = keys[next++];
        if (key === 'connect') {
          const query = db(column.table.name).update(column.name, id);
          for (const arg of args[key]) {
            query.orWhere(arg);
          }
          query.then(_resolve).catch(reject);
        } else if (key === 'create') {
          const rows = args[key].map(x => ({ [column.name]: id, ...x }));
          db
            .insert(rows)
            .into(column.table.name)
            .then(_resolve)
            .catch(reject);
        } else if (key === 'upsert') {
          let upserts = args[key].map(arg => ({
            create: { [column.name]: id, ...arg.create },
            update: { [column.name]: id, ...arg.update }
          }));
          upserts = upserts.map(arg => upsert(db, column.table, arg));
          Promise.all(upserts)
            .then(_resolve)
            .catch(reject);
        } else if (key === 'delete') {
          const wheres = args[key];
          if (wheres.length > 0) {
            db(column.table.name)
              .where(column.name, id)
              .andWhere(function() {
                for (const where of wheres) {
                  this.orWhere(where);
                }
              })
              .del()
              .then(_resolve)
              .catch(reject);
          } else {
            _resolve();
          }
        } else if (key === 'set') {
          setRelated(db, column, id, args[key])
            .then(_resolve)
            .catch(reject);
        } else {
          reject(Error('Unknown mutation: ' + key));
        }
      }
    }
    _resolve();
  });
}

// set { connect: [], create: [], upsert: [] }
function setRelated(db, column, id, args) {
  const promises = [];
  for (const key in args) {
    switch (key) {
      case 'connect':
        promises.push(connect(db, column, id, args.connect));
        break;
      case 'create':
        for (const arg of args.create) {
          promises.push(
            createRow(db, column.table, { [column.name]: id, ...arg })
          );
        }
        break;
      case 'upsert':
        args[key].forEach(arg =>
          promises.push(
            upsert(db, column.table, {
              create: { [column.name]: id, ...arg.create },
              update: { [column.name]: id, ...arg.update }
            })
          )
        );
        break;
      default:
        return Promise.reject(Error('Not supported: ' + key));
    }
  }
  return Promise.all(promises).then(rows => {
    return db(column.table.name)
      .del()
      .whereNot(function() {
        for (const row of [].concat.apply([], rows)) {
          this.orWhere(row);
        }
      });
  });
}

function connect(db, column, id, args) {
  return new Promise((resolve, reject) => {
    const columns = column.table.primaryKey.name;
    selectRow(db, column.table, args, columns).then(rows => {
      db
        .table(column.table.name)
        .update(column.name, id)
        .where(function() {
          for (const row of rows) {
            this.orWhere(row);
          }
        })
        .then(() => resolve(rows))
        .catch(reject);
    });
  });
}
