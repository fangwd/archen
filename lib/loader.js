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
            const column = table._column(index.columns[0]);
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
      return table.mapFrom(rows);
    });
  }

  load(column, value) {
    const loader = this.loaders[column.table.name][column.name].loader;
    return value ? loader.load(value) : null;
  }

  create(table, args) {
    return this.db.transaction(trx => createRow(trx, table, args.data));
  }

  update(table, args) {
    return this.db.transaction(trx => updateRow(trx, table, args));
  }

  upsert(table, args) {
    return this.db.transaction(trx => upsert(trx, table, args));
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
        query.where(builder.buildWhere(where, 0));
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
          } else {
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

  buildWhere(args, level) {
    const me = this;
    return function() {
      for (const key in args) {
        let column = me.table._column(key);
        let name, op;
        if (column) {
          name = column;
        } else {
          [name, op] = splitWhereArg(key); // __
          column = me.table.column(name);
          if (column) {
            name = column._name;
          }
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
          case 'exists':
            if (value) this.whereNotNull(me.scope(name));
            else this.whereNull(me.scope(name));
            break;
          case 'some':
            this.whereExists(me._buildQuery(name, value, level));
            break;
          case 'none':
            this.whereNotExists(me._buildQuery(name, value, level));
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
                const column = me.table.foreignKey(name);
                if (column) {
                  const builder = new Builder(me, column.references.table);
                  builder.number = me.context.map[level][name];
                  this.where(builder.buildWhere(value, level + 1));
                } else if (value && typeof value === 'object') {
                  const where = transformWhere(me.table, value);
                  this.where(where);
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

  join(query, args) {
    args = transformWhere(this.table, args);
    for (const key in args) {
      const [name, op] = splitWhereArg(key); // __
      const value = args[key];
      if (!op && !/^(AND|OR|NOT)$/i.test(name)) {
        if (this.table.foreignKey(name)) {
          const table = this.table.foreignKey(name).references.table;
          const builder = new Builder(this, table);
          const left = this.scope(this.table.column(table));
          const right = builder.scope(table.primaryKey);
          query.join(builder.as(table), left, right);
          const level = this.number;
          this.context.map[level] = this.context.map[level] || {};
          this.context.map[level][name] = builder.number;
          builder.join(query, value);
        }
      }
    }
  }

  _buildQuery(name, args, level) {
    const column = this.table.relatedKey(name);
    const builder = new Builder(this, column.table);
    const left = builder.scope(column);
    const right = this.scope(this.table.primaryKey);
    const query = builder.select();
    builder.join(query, args, builder.number);
    query.where(builder.buildWhere(args, builder.number));
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
    query.where(builder.buildWhere(args.where, 0));
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
  create = table.mapTo(create);
  update = table.mapTo(update);
  return resolveFields(db, table, create).then(create => {
    return resolveFields(db, table, update).then(update => {
      return _upsert(create[0], update[0]);
    });
  });

  function _upsert(create, update) {
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
        return selectRow(db, table, table.getUniqueFields(fields), '*');
      });
    } else {
      // Postgres: return db.raw('? on conflict (??) do ?', [insert, update]);
      return Promise.reject('Not supported.');
    }
  }
}

module.exports = { Loader };

function resolveFields(db, table, args) {
  const result = {},
    todos = [],
    patches = [];
  for (const key in args) {
    let column = table._column(key);
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
                result[column._name] = row[Object.keys(row)[0]];
                _resolve();
              }
            });
          } else {
            if (key !== 'create') throw Error('Unknown: ' + key);
            createRow(db, column.references.table, args.create).then(row => {
              result[column._name] =
                row[column.references.table.primaryKey.name];
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
    const data = table.mapTo(args);
    resolveFields(db, table, data)
      .then(result => {
        const [data, todos] = result;
        db(table.name)
          .insert(data)
          .then(id => {
            if (Array.isArray(id)) id = id[0];
            return resolveRelatedFields(db, id, todos).then(() => {
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
  const builder = new Builder(db, table, true);
  const where = builder.buildWhere(transformWhere(table, args.where), 0);
  return new Promise((resolve, reject) => {
    const data = table.mapTo(args.data);
    resolveFields(db, table, data)
      .then(result => {
        const [data, todos] = result;
        function _resolve() {
          return selectRow(db, table, where, '*').then(row => {
            if (!row) return reject(new Error('Not found.'));
            const id = row[table.primaryKey.name];
            return resolveRelatedFields(db, id, todos).then(() => {
              resolve(row);
            });
          });
        }
        return Object.keys(data).length > 0
          ? db(table.name)
              .update(data)
              .where(where)
              .then(_resolve)
          : _resolve();
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
        rows = table.mapFrom(rows);
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

function serialise(op, argv) {
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
          const query = db(column.table.name).update(column._name, id);
          args = column.table.mapTo(args);
          for (const arg of args[key]) {
            if (Object.keys(arg).length === 1) {
              const key = Object.keys(arg)[0];
              if (arg[key] && typeof arg[key] === 'object') {
                // we don't do recursive
                query.orWhere(column.table.mapTo(arg[key]));
                continue;
              }
            }
            query.orWhere(arg);
          }
          query.then(_resolve).catch(reject);
        } else if (key === 'create') {
          let rows = column.table.mapTo(args[key]);
          rows = rows.map(x => ({ [column._name]: id, ...x }));
          serialise(row => resolveFields(db, column.table, row), rows).then(
            rows => {
              // We don't do patches
              rows = rows.map(x => x[0]);
              db
                .insert(rows)
                .into(column.table.name)
                .then(_resolve)
                .catch(reject);
            }
          );
        } else if (key === 'upsert') {
          let upserts = args[key].map(arg => ({
            create: { [column.name]: id, ...arg.create },
            update: { [column.name]: id, ...arg.update }
          }));
          upserts = upserts.map(arg => upsert(db, column.table, arg));
          Promise.all(upserts)
            .then(_resolve)
            .catch(reject);
        } else if (key === 'update') {
          const rows = args[key].map(x => ({
            data: x.data,
            where: { ...x.where, [column.name]: id }
          }));
          const updates = rows.map(arg => updateRow(db, column.table, arg));
          Promise.all(updates)
            .then(_resolve)
            .catch(reject);
        } else if (key === 'delete') {
          const wheres = args[key];
          if (wheres.length > 0) {
            db(column.table.name)
              .where(column._name, id)
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

function transformWhere(table, where) {
  const result = {};
  for (const key in where) {
    let [name, op] = splitWhereArg(key); // __
    if (/^(AND|OR|NOT)$/.test(name)) {
      result[key] = where[key];
    } else {
      const column = table.column(name);
      if (column) {
        name = column._name;
      }
      if (op) {
        name = `${name}_${op}`;
      }
      result[name] = where[key];
    }
  }
  return result;
}

function splitWhereArg(arg) {
  const match = /^(.+?)_([^_]+)$/.exec(arg);
  return match ? [match[1], match[2]] : [arg];
}
