class Database {
  constructor({ name, tables }) {
    this.name = name;
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

    this._columnMap = new Map(this.columns.map(column => [column.name, column]));

    this._names = { object: {}, related: {} };

    for (const index of this.indexes) {
      if (index.primaryKey) {
        this.primaryKey = index.columns.map(column => this._columnMap.get(column));
        if (this.primaryKey.length == 1) {
          this.primaryKey = this.primaryKey[0];
          this.primaryKey.unique = true;
        }
      } else if (index.unique && index.columns.length == 1) {
        this.column(index.columns[0]).unique = true;
      }
    }
  }

  _resolveReferences() {
    for (const foreignKey of this.foreignKeys) {
      if (foreignKey.columns.length == 1) {
        const referencedTable = this.db.table(foreignKey.referencedTable);
        const referencedColumn = referencedTable.column(foreignKey.referencedColumns[0]);
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

      if (this.referenceCount(column.references.table) === 1) {
        const name = column.shortName;
        if (!this.column(name) && !this._names.object[name]) {
          column.setObjectName(name);
          continue;
        }
      }

      const tableName = column.references.table.name;
      for (let i = 0; ; i++) {
        const name = column.shortName + (i ? i : '') + '_' + tableName;
        if (!this._names.object[name] && !this.column(name)) {
          column.setObjectName(name);
          break;
        }
      }
    }

    for (const column of this.columns) {
      if (!column.references) {
        continue;
      }

      const table = column.references.table;

      if (this.referenceCount(table) === 1) {
        const name = this.name;
        if (!table.column(name) && !table._names.object[name]) {
          column.setRelatedName(name);
          continue;
        }
      }

      for (let i = 0; ; i++) {
        const name = this.name + (i ? i : '') + '_' + column.shortName + '_set';
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
      throw Error('Bad type')
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

  getReferenced(name) {
    const column = this._names.object[name];
    return column.references.table;
  }

  getRelated(name) {
    return this._names.related[name];
  }
}

class Column {
  constructor(table, { name, type, size, nullable }) {
    this.table = table;
    this.name = name;
    this.type = type;
    this.size = size;
    this.nullable = nullable;
    this.references = undefined;
    this.referencedBy = new Set();
    this.unique = false;

    const match = /^(.+?)(_[Ii][Dd]|Id)$/.exec(this.name);
    this.shortName = match ? match[1] : this.name;
  }

  setObjectName(name) {
    this.objectName = name;
    this.table._names.object[name] = this;
  }

  setRelatedName(name) {
    this.relatedName = name;
    this.references.table._names.related[name] = this;
  }
}

module.exports = { Database, Table, Column };
