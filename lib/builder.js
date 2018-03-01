const graphql = require('graphql');

import { Column } from './database';

const QueryOptions = {
  limit: { type: graphql.GraphQLInt },
  offset: { type: graphql.GraphQLInt },
  orderBy: { type: graphql.GraphQLString },
};

class Builder {
  constructor(db, options = { plural: {} }) {
    this.db = db;
    this.options = options;
  }

  // TODO: Break into smaller methods
  build() {
    const modelFields = {};

    const modelTypes = {};
    for (const table of this.db.tables) {
      const modelType = new graphql.GraphQLObjectType({
        name: table.name,
        fields() {
          return modelFields[table.name];
        },
      });
      modelTypes[table.name] = modelType;
    }

    this.modelTypes = modelTypes;

    const whereTypes = {};
    const whereFields = {};

    for (const table of this.db.tables) {
      const fields = {};
      for (const column of table.columns) {
        const fieldType = getType(column.type);
        fields[column.name] = { type: fieldType };
        for (const op of ['lt', 'le', 'ge', 'gt', 'ne']) {
          const name = column.name + '__' + op;
          fields[name] = { type: fieldType };
        }
        for (const op of ['is_null']) {
          const name = column.name + '__' + op;
          fields[name] = { type: graphql.GraphQLBoolean };
        }
        for (const op of ['in']) {
          const name = column.name + '__' + op;
          fields[name] = { type: new graphql.GraphQLList(fieldType) };
        }
        if (fieldType === graphql.GraphQLString) {
          const name = column.name + '__like';
          fields[name] = { type: fieldType };
        }
      }
      const whereType = new graphql.GraphQLInputObjectType({
        name: table.name + 'WhereType',
        fields() {
          return fields;
        },
      });
      fields['_and'] = { type: new graphql.GraphQLList(whereType) };
      fields['_or'] = { type: new graphql.GraphQLList(whereType) };
      fields['_not'] = { type: new graphql.GraphQLList(whereType) };
      whereTypes[table.name] = whereType;
      whereFields[table.name] = fields;
    }

    this.uniqueWhereTypes = {};

    for (const table of this.db.tables) {
      const fields = {};
      for (const index of table.indexes) {
        if (index.columns.length == 1) {
          const column = table.column(index.columns[0]);
          fields[column.name] = { type: getType(column.type) };
        } else {
          const name = index.name || index.columns.sort().join('_');
          const indexFields = {};
          for (const column of index.columns) {
            indexFields[column] = { type: getType(table.column(column)) };
          }
          const indexType = new graphql.GraphQLInputObjectType({
            name: table.name + 'IndexType' + name,
            fields: indexFields,
          });
          fields[name] = { type: indexType };
        }
      }
      const uniqueWhereType = new graphql.GraphQLInputObjectType({
        name: table.name + 'UniqueWhereType',
        fields() {
          return fields;
        },
      });
      this.uniqueWhereTypes[table.name] = uniqueWhereType;
    }

    for (const table of this.db.tables) {
      modelFields[table.name] = {};
      for (const column of table.columns) {
        modelFields[table.name][column.name] = { type: getType(column.type) };
        if (column.references) {
          modelFields[table.name][column.objectName] = {
            type: modelTypes[column.references.table.name],
            resolve(obj, args, req) {
              return req.loader.load(column.references, obj[column.name]);
            },
          };
          whereFields[table.name][column.objectName] = {
            type: whereTypes[column.references.table.name],
          };
        }
        column.referencedBy.forEach(col => {
          const fieldName = this.pluralise(col.table.name);
          modelFields[table.name][fieldName] = {
            type: new graphql.GraphQLList(modelTypes[col.table.name]),
            args: { where: { type: whereTypes[col.table.name] }, ...QueryOptions },
            resolve(object, args, context) {
              if (args.where) {
                args.where[col.name] = object[column.name];
                return context.loader.query(col.table, args);
              } else {
                return context.loader.load(col, object[column.name]);
              }
            },
          };
          for (const op of ['some', 'none']) {
            const fieldName = col.relatedName + '__' + op;
            whereFields[table.name][fieldName] = { type: whereTypes[col.table.name] };
          }
        });
      }
    }

    const queryFields = {};

    for (const table of this.db.tables) {
      const name = this.pluralise(table.name);
      queryFields[name] = {
        type: new graphql.GraphQLList(modelTypes[table.name]),
        args: { where: { type: whereTypes[table.name] }, ...QueryOptions },
        resolve(_, args, context) {
          return context.loader.query(table, args);
        },
      };
      queryFields[table.name] = {
        type: modelTypes[table.name],
        args: { where: { type: whereTypes[table.name] } },
        resolve(_, args, context) {
          return new Promise(resolve => {
            context.loader.query(table, args).then(rows => {
              resolve(rows[0]);
            });
          });
        },
      };
    }

    const schema = new graphql.GraphQLSchema({
      query: new graphql.GraphQLObjectType({
        name: 'Query',
        fields: queryFields,
      }),
      mutation: new graphql.GraphQLObjectType({
        name: 'Mutation',
        fields: this.buildMutationFields(),
      }),
    });

    // require('fs').writeFileSync('schema.graphql', graphql.printSchema(schema));

    return schema;
  }

  buildMutationFields() {
    const inputTypes = {};
    const inputTypesAny = {};

    const inputFields = {};
    const inputFieldsAny = {};

    for (const table of this.db.tables) {
      const inputType = new graphql.GraphQLInputObjectType({
        name: table.name + 'InputType',
        fields() {
          return inputFields[table.name];
        },
      });
      inputTypes[table.name] = { type: inputType };

      const inputTypeAny = new graphql.GraphQLInputObjectType({
        name: table.name + 'InputTypeAny',
        fields() {
          return inputFieldsAny[table.name];
        },
      });
      inputTypesAny[table.name] = { type: inputTypeAny };
    }

    for (const table of this.db.tables) {
      inputFields[table.name] = {};
      inputFieldsAny[table.name] = {};
      for (const column of table.columns) {
        inputFields[table.name][column.name] = { type: getType(column) };
        inputFieldsAny[table.name][column.name] = { type: getType(column.type) };
      }
    }

    const mutationFields = {};

    for (const table of this.db.tables) {
      const name = 'create_' + table.name;
      mutationFields[name] = {
        type: this.modelTypes[table.name],
        args: { data: inputTypes[table.name] },
        resolve(_, args, context) {
          return context.loader.create(table, args);
        },
      };
    }

    for (const table of this.db.tables) {
      const name = 'update_' + table.name;
      mutationFields[name] = {
        type: this.modelTypes[table.name],
        args: {
          where: { type: this.uniqueWhereTypes[table.name] },
          data: inputTypes[table.name],
        },
        resolve(_, args, context) {
          return context.loader.update(table, args);
        },
      };
    }

    for (const table of this.db.tables) {
      const name = 'upsert_' + table.name;
      mutationFields[name] = {
        type: this.modelTypes[table.name],
        args: {
          create: inputTypes[table.name],
          update: inputTypesAny[table.name],
        },
        resolve(_, args, context) {
          return context.loader.upsert(table, args);
        },
      };
    }

    for (const table of this.db.tables) {
      const name = 'delete_' + table.name;
      mutationFields[name] = {
        type: this.modelTypes[table.name],
        args: {
          where: { type: this.uniqueWhereTypes[table.name] },
        },
        resolve(_, args, context) {
          return context.loader.delete(table, args);
        },
      };
    }

    return mutationFields;
  }

  _buildInputTypeName(table, any) {
    return table.name + 'InputType' + (any ? 'Any' : '');
  }

  pluralise(s) {
    return this.options.plurals[s] || s + 's';
  }
}

function getType(type) {
  if (type instanceof Column) {
    return getInputType(type);
  }

  if (/char|text/i.test(type)) {
    return graphql.GraphQLString;
  } else if (/^int/i.test(type)) {
    return graphql.GraphQLInt;
  } else if (/float|double/i.test(type)) {
    return graphql.GraphQLFloat;
  } else if (/^bool/i.test(type)) {
    return graphql.GraphQLBoolean;
  }

  return graphql.GraphQLString;
}

function getInputType(column) {
  const type = getType(column.type);
  return column.nullable ? type : new graphql.GraphQLNonNull(type);
}

module.exports = { Builder };
