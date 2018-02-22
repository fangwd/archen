const DataLoader = require('dataloader');
const { Database, Column } = require('./database');

class Loader {
  constructor(conn, data) {
    this.db = conn;
    this.queryLoader = createQueryLoader(conn);
    this.loaders = {};

    const db = new Database(data);
    for (const table of db.tables) {
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
    const self = this;
    const loader = new DataLoader(keys => {
      return new Promise((resolve, reject) => {
        self.db
          .table(column.table.name)
          .whereIn(column.name, keys)
          .then(rows => {
            const loaders = self.loaders[column.name];
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

  query(tableName, args) {
    const query = buildQuery(this.db, tableName, args);
    const self = this;
    return this.queryLoader.load(query).then(rows => {
      const loaders = self.loaders[tableName];
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

function getWheres(wheres, and = true) {
  return function() {
    for (const where of wheres) {
      if (and) {
        this.where(getWhere(where));
      } else {
        this.orWhere(getWhere(where));
      }
    }
  };
}

function getWhere(where) {
  return function() {
    for (const key in where) {
      const [name, op] = key.split(/__/);
      const value = where[key];
      switch (op) {
        case 'lt':
          this.where(name, '<', value);
          break;
        case 'le':
          this.where(name, '<=', value);
          break;
        case 'ge':
          this.where(name, '>=', value);
          break;
        case 'gt':
          this.where(name, '>', value);
          break;
        case 'ne':
          this.where(name, '!=', value);
          break;
        case 'like':
          this.where(name, 'like', value);
          break;
        case 'in':
          this.whereIn(name, value);
          break;
        case 'is_null':
          if (value) this.whereNull(name);
          else this.whereNotNull(name);
          break;
        default:
          if (!op) {
            if (name === '_and') {
              this.where(getWheres(value));
            } else if (name == '_or') {
              this.orWhere(getWheres(value, false));
            } else if (name == '_not') {
              this.whereNot(getWheres(value, false));
            } else {
              // TODO: if value is an object do join and run through the params
              this.where(name, value);
            }
          } else {
            throw `Unknown comparison operator: ${op}`;
          }
      }
    }
  };
}

function buildQuery(db, table, args) {
  let query = db.table(table);

  if (args.where) {
    query.where(getWhere(args.where));
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
