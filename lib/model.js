const { pluralise } = require('./forms');

class Database {
  constructor({ name, tables }, options = {}) {
    this.name = name;
    options.pluralise = options.pluralise || pluralise;
    this.options = options;
    this.tables = tables.map(table => new Table(this, table));
    this._tableMap = new Map(this.tables.map(table => [table.name, table]));

    for (const table of this.tables) {
      table._resolveReferences();
      table._resolveNames();
    }
  }

  table(name) {
    return this._tableMap.get(name);
  }
}

class Table {
  constructor(db, { name, columns, indexes, foreignKeys }) {
    this.db = db;
    this.name = name;
    this.columns = columns.map(column => new Column(this, column));
    this.indexes = indexes || [];
    this.foreignKeys = foreignKeys || [];
    this.pluralName = this.db.options.pluralise(this.name);

    this._columnMap = new Map(
      this.columns.map(column => [column.name, column])
    );

    this._names = { object: {}, related: {} };

    for (const index of this.indexes) {
      if (index.primaryKey) {
        this.primaryKey = index.columns.map(column =>
          this._columnMap.get(column)
        );
        if (this.primaryKey.length == 1) {
          this.primaryKey = this.primaryKey[0];
          this.primaryKey.unique = true;
        }
      } else if (index.unique && index.columns.length == 1) {
        this.column(index.columns[0]).unique = true;
      }
    }

    this._names = { foreign: {}, related: {} };
  }

  _resolveReferences() {
    for (const foreignKey of this.foreignKeys) {
      if (foreignKey.columns.length == 1) {
        const referencedTable = this.db.table(foreignKey.referencedTable);
        const referencedColumn = referencedTable.column(
          foreignKey.referencedColumns[0]
        );
        this.column(foreignKey.columns[0]).references = referencedColumn;
        referencedColumn.referencedBy.add(this.column(foreignKey.columns[0]));
      }
    }
  }

  _resolveNames() {
    for (const column of this.columns) {
      if (!column.references) {
        continue;
      }

      const foreignName = column.name.replace(/(_id|Id)$/, '');
      if (this.referenceCount(column.references.table) === 1) {
        // node_id => node
        if (!this.column(foreignName) && !this._names.foreign[foreignName]) {
          column.setForeignName(foreignName);
          continue;
        }
      }

      const tableName = column.references.table.name;
      for (let i = 0; ; i++) {
        // left_node, right_node
        const name = foreignName + (i ? i : '') + '_' + tableName;
        if (!this._names.foreign[name] && !this.column(name)) {
          column.setForeignName(name);
          break;
        }
      }
    }

    const pluralName = this.db.options.pluralise(this.name);

    for (const column of this.columns) {
      if (!column.references) {
        continue;
      }

      const table = column.references.table;

      if (this.referenceCount(table) === 1) {
        if (!table.column(pluralName) && !table._names.related[pluralName]) {
          column.setRelatedName(pluralName);
          continue;
        }
      }

      const shortName = column.name.replace(/(_id|Id)$/, '');
      for (let i = 0; ; i++) {
        const name = pluralName + '_' + shortName + (i ? i : '');
        if (!table._names.related[name] && !table.column(name)) {
          column.setRelatedName(name);
          break;
        }
      }
    }
  }

  // Returns the number of columns which reference the given table.
  referenceCount(table) {
    let count = 0;
    if (!(table instanceof Table)) {
      throw Error('Bad type');
    }
    for (const column of this.columns) {
      if (column.references && column.references.table === table) {
        count++;
      }
    }
    return count;
  }

  column(name) {
    if (typeof name === 'string') {
      return this._columnMap.get(name);
    }
    return this.columns.find(c => c.references && c.references.table === name);
  }

  foreignKey(name) {
    return this._names.foreign[name];
  }

  relatedKey(name) {
    return this._names.related[name];
  }

  getUniqueFields(row) {
    for (const index of this.indexes) {
      if (index.unique) {
        let missingColumn;
        for (const column of index.columns) {
          if (row[column] === undefined) {
            missingColumn = column;
            break;
          }
        }
        if (!missingColumn) {
          const fields = {};
          for (const column of index.columns) {
            fields[column] = row[column];
          }
          return fields;
        }
      }
    }
  }
}

class Column {
  constructor(table, { name, type, size, nullable, autoIncrement }) {
    this.table = table;
    this.name = name;
    this.type = type;
    this.size = size;
    this.nullable = nullable;
    this.references = undefined;
    this.referencedBy = new Set();
    this.unique = false;
    this.autoIncrement = autoIncrement;
  }

  setForeignName(name) {
    this.foreignName = name;
    this.table._names.foreign[name] = this;
  }

  setRelatedName(name) {
    this.relatedName = name;
    this.references.table._names.related[name] = this;
  }
}

module.exports = { Database, Table, Column };
