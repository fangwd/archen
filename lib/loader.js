const DataLoader = require('dataloader');
const { Database, Column } = require('./database');

class Loader {
  constructor(conn, data) {
    this.db = conn;
    this.queryLoader = createQueryLoader(conn);
    this.loaders = {};
    this.schema = new Database(data);
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
  constructor(db, table) {
    if (db instanceof Builder) {
      this.db = db.db;
      this.context = db.context;
    } else {
      this.db = db;
      this.context = { counter: 0, map: {} };
    }
    this.table = table;
    this.number = this.context.counter++;
  }

  select() {
    return this.db.select(this.scope()).from(this.as());
  }

  scope(name) {
    if (name instanceof Column) {
      name = name.name;
    }
    return `t${this.number}.${name || '*'}`;
  }

  as(table) {
    table = table || this.table;
    return `${table.name} as t${this.number}`;
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
          default:
            if (!op) {
              if (/^_(and|or|not)$/i.test(name)) {
                this.where(me.joinWhere(value, name, level));
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

  reset(table) {
    this.table = table;
    this.context.counter = 0;
    this.number = this.context.counter++;
  }
}

function buildQuery(db, table, args) {
  let builder = new Builder(db, table);
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

module.exports = { Loader };
