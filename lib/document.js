const graphql = require('graphql');
const fs = require('fs');
const path = require('path');

const scalarTypes = ['ID', 'Int', 'String', 'Float', 'Boolean', 'DateTime'];
const isScalarType = type => scalarTypes.indexOf(type) > -1;
const graphqlToSqlType = (typeName) => {
  let type;

  switch (typeName) {
    case 'ID':
    case 'Int':
      type = 'int';
      break;
    case 'DateTime':
    case 'String':
      type = 'varchar'
      break;
    case 'Float':
      type = 'float';
      break;
    case 'Boolean':
      type = 'boolean';
      break;
    default:
      'int';
  }

  return type;
}

class Document {
  constructor(schema) {
    this.document = graphql.parse(new graphql.Source(schema));

    this.tables = this.document.definitions
      .filter(definition => definition.kind === 'ObjectTypeDefinition')
      .map(objectType => new Table(this, objectType));

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
  constructor(document, objectType) {
    this.document = document;
    this.objectType = objectType;
    this.name = objectType.name.value;
    this.columns = objectType.fields.map(field => new Column(this, field));
    this.relationshipFields = this.columns.filter(column => !isScalarType(column.graphqlType));
    this._columnMap = new Map(this.columns.map(column => [column.name, column]));
    this.indexes = [];
    this.foreignKeys = [];

    this._names = { object: {}, related: {} };

    this.foreignKeys = this.relationshipFields.map(field => ({
      columns: [field.name],
      referencedTable: field.graphqlType,
      referencedColumns: ['id'],
    }));

    if (objectType.directives.length) {
      const options = objectType.directives.find(directive => directive.name.value === 'options');

      if (options) {
        const indexes = options.arguments.find(argument => argument.name.value === 'indexes');
        if (indexes) {
          this.indexes = indexes.value.values.map((index) => {
            const name = index.fields.find(field => field.name.value === 'name');
            const columns = index.fields.find(field => field.name.value === 'columns');
            const unique = index.fields.find(field => field.name.value === 'unique');

            return {
              name: name.value.value,
              unique: unique.value.value,
              columns: columns.value.values.map(value => value.value),
            }
          });
        }
      }
    }

    this.primaryKey = this.columns.find(column => column.graphqlType === 'ID');
    if (this.primaryKey) {
      this.primaryKey.unique = true;
      this.indexes.push({
        primaryKey: true,
        columns: [this.primaryKey.name],
      });
    }


    for (const foreignKey of this.foreignKeys) {
      this.indexes.push({
        name: foreignKey.columns[0],
        columns: foreignKey.columns,
      });
    }

    const uniqueColumns = this.columns.filter(column => column.unique);

    for (const column of uniqueColumns) {
      this.indexes.push({
        name: column.name,
        unique: true,
        columns: [column.name],
      });
    }
  }

  _resolveReferences() {
    for (const foreignKey of this.foreignKeys) {
      if (foreignKey.columns.length == 1) {
        const referencedTable = this.document.table(foreignKey.referencedTable);
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
    return this._columnMap.get(name);
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
  constructor(table, field) {
    this.table = table;
    this.field = field;

    this.name = field.name.value;
    this.nullable = field.type.kind !== 'NonNullType';
    this.graphqlType = this.nullable ? field.type.name.value : field.type.type.name.value;
    this.type = this.nullable ? graphqlToSqlType(field.type.kind) : graphqlToSqlType(field.type.type.kind);
    this.size = null;
    this.defaultValue = null;
    this.references = null;
    this.referencedBy = new Set();
    this.unique = false;

    const match = /^(.+?)(_[Ii][Dd]|Id)$/.exec(this.name);
    this.shortName = match ? match[1] : this.name;

    if (field.directives.length) {
      const options = field.directives.find(directive => directive.name.value === 'options');
      const unique = field.directives.find(directive => directive.name.value === 'unique');

      if (unique) {
        this.unique = true;
      }

      if (options) {
        const sizeOption = options.arguments.find(argument => argument.name.value === 'size');
        if (sizeOption) {
          this.size = sizeOption.value.value;
        }

        const defaultValueOption = options.arguments.find(argument => argument.name.value === 'defaultValue');
        if (defaultValueOption) {
          this.defaultValue = defaultValueOption.value.value;
        }
      }
    }
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

module.exports = { Document, Table, Column };
