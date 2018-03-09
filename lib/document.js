const graphql = require('graphql');

class Document {
  constructor(schema) {
    const document = graphql.parse(schema);

    this._tableMap = {};

    for (const definition of document.definitions) {
      if (definition.kind === 'ObjectTypeDefinition') {
        this._tableMap[definition.name.value] = this._buildTable(definition);
      }
    }

    for (const table of Object.values(this._tableMap)) {
      for (const column of table.columns) {
        const referencedTable = this._tableMap[column.type];
        if (referencedTable) {
          table.foreignKeys.push({
            columns: [column.name],
            referencedColumns: [getPrimaryKey(referencedTable).name],
            referencedTable: referencedTable.name
          });
        }
      }
    }
  }

  json() {
    return { tables: Object.values(this._tableMap) };
  }

  _buildTable(definition) {
    const table = { columns: [], indexes: [], foreignKeys: [] };

    table.name = definition.name.value;

    for (const field of definition.fields) {
      const column = this._buildColumn(field);
      if (column) {
        table.columns.push(column);
        if (column.primaryKey) {
          table.indexes.push({
            columns: [column.name],
            primaryKey: true
          });
        } else if (column.unique) {
          table.indexes.push({
            columns: [column.name],
            unique: true
          });
        }
      }
    }

    for (const directive of definition.directives) {
      if (directive.name.value === 'table') {
        for (const arg of directive.arguments) {
          switch (arg.name.value) {
            case 'name':
              table._name = arg.value.value;
              break;
            case 'unique':
              table.indexes = table.indexes.concat(
                arg.value.values.map(value => {
                  const index = { unique: true };
                  for (const field of value.fields) {
                    switch (field.name.value) {
                      case 'name':
                        index.name = field.value.value;
                        break;
                      case 'columns':
                        // Note: column names, not object names (jpa::UniqueConstraint)
                        index.columns = field.value.values.map(x => x.value);
                        break;
                      default:
                        throw Error(`Unknown property: ${field.name.value}`);
                    }
                  }
                  return index;
                })
              );
              break;
            default:
              break;
          }
        }
        break;
      }
    }
    return table;
  }

  _buildColumn(field) {
    const column = {};

    column.name = field.name.value;

    // 2.11 Input Types
    switch (field.type.kind) {
      case 'NamedType':
        column.type = field.type.name.value;
        break;
      case 'NonNullType':
        if (field.type.type.kind === 'NamedType') {
          column.nullable = false;
          column.type = field.type.type.name.value;
        }
        break;
      case 'ListType':
        break;
      default:
        throw Error(`Unknown type: ${field.type.kind}`);
    }

    if (!column.type) return;

    if (column.type === 'ID') {
      column.primaryKey = true;
      column.type = 'Int';
    }

    // user: User! @column(name: "user_id", unique: true)
    for (const directive of field.directives) {
      if (directive.name.value === 'column') {
        for (const arg of directive.arguments) {
          switch (arg.name.value) {
            case 'name':
              column._name = arg.value.value;
              break;
            case 'size':
              column.size = arg.value.value;
              break;
            case 'unique':
              column.unique = true;
              break;
            case 'default':
              column.defaultValue = arg.value.value;
              break;
            default:
              break;
          }
        }
        break;
      }
    }

    return column;
  }
}

function getPrimaryKey(table) {
  return table.columns.find(column => column.primaryKey);
}

module.exports = { Document };
