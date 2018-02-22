class Database {
  constructor({ name, tables }) {
    this.name = name;
    this.tables = tables.map(table => new Table(this, table));
    this._tableMap = new Map(this.tables.map(table => [table.name, table]));
    for (const table of this.tables) {
      table._resolveReferences();
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

  column(name) {
    return this._columnMap.get(name);
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
  }
}

module.exports = { Database, Table, Column };
