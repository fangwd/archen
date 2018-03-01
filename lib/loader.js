const DataLoader = require('dataloader');
const { Column } = require('./database');

class Loader {
  constructor(conn, schema) {
    this.db = conn;
    this.queryLoader = createQueryLoader(conn);
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
          .whereIn(column.name, keys)
          .then(rows => {
            const loaders = me.loaders[column.name];
            for (const row of rows) {
              for (const columnName in loaders) {
                if (columnName != column.name && loaders[columnName].column.unique) {
                  loaders[columnName].loader.prime(row[columnName], row);
                }
              }
            }
            if (column.unique) {
              resolve(keys.map(key => rows.find(row => row[column.name] === key)));
            } else {
              resolve(keys.map(key => rows.filter(row => row[column.name] === key)));
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
    return new Promise(resolve => {
      this.db(table.name)
        .insert(args.data)
        .then(id => {
          resolve({ id, ...args.data });
        })
        .catch(e => {
          resolve(Error(e.code));
        });
    });
  }

  update(table, args) {
    const where = firstOf(args.where);
    if (!where) {
      return Error('Empty where.');
    }
    const me = this;
    return new Promise(resolve => {
      const query = this.db(table.name);
      const builder = new Builder(this.db, table, true);
      query.where(builder.buildWhere(where));
      query.update(args.data).then(() => {
        me.query(table, { where }).then(rows => {
          resolve(rows[0]);
        });
      });
    });
  }

  upsert(table, args) {
    const me = this;
    return new Promise(resolve => {
      upsert(this.db, table.name, args.create, args.update).then(() => {
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
        const promises = queries.map((query, index) => makePromise(query, index));
        Promise.all(promises).then(responses => {
          const results = [];
          responses.forEach(r => (results[r.index] = r.response[0]));
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
      name = name.name;
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
        const [name, op] = key.split(/__/);
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
              if (name === '_and') {
                this.andWhere(me.joinWhere(value, name, level));
              } else if (name === '_or') {
                this.orWhere(me.joinWhere(value, name, level));
              } else if (name === '_not') {
                this.whereNot(me.joinWhere(value, name, level));
              } else {
                if (value !== null && typeof value === 'object') {
                  const table = me.table.getReferenced(name);
                  if (!table) {
                    const error = Error(`${me.table.name} ${name}`);
                    throw error;
                  }
                  const builder = new Builder(me, table);
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
      const [name, op] = key.split(/__/);
      const value = args[key];
      if (!op && !/^_(and|or|not)$/i.test(name)) {
        if (value !== null && typeof value === 'object') {
          const table = this.table.getReferenced(name);
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
    const column = this.table.getRelated(name);
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
  return obj[Object.keys(obj)[0]];
}

function upsert(knex, table, insert, update) {
  insert = knex(table).insert(insert);
  update = knex.queryBuilder().update(update);
  if (/mysql/i.test(knex.client.dialect)) {
    update = update.toString().replace(/^\s*update\s+set/i, 'update');
    const query = knex.raw('? on duplicate key ' + update, [insert]);
    return query;
  } else {
    // Postgres:
    // return knex.raw('? on conflict (??) do ?', [insert, update]);
    throw Error('Not implemented.');
  }
}

module.exports = { Loader };
