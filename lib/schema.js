const graphql = require('graphql');
const { GraphQLDate, GraphQLTime, GraphQLDateTime } = require('graphql-iso-date');

const { Database, Column } = require('./model');
const { snakeToCamel, snakeToPascal } = require('./forms');

const QueryOptions = {
  limit: { type: graphql.GraphQLInt },
  offset: { type: graphql.GraphQLInt },
  orderBy: { type: graphql.GraphQLString }
};

class Builder {
  constructor(db, options = {}) {
    this.db = db instanceof Database ? db : new Database(db);
    this.options = options;
  }

  build() {
    const modelFields = {};

    const modelTypes = {};
    for (const table of this.db.tables) {
      const modelType = new graphql.GraphQLObjectType({
        name: table._names.pascal,
        fields() {
          return modelFields[table.name];
        }
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
          const name = column.name + '_' + op;
          fields[name] = { type: fieldType };
        }
        for (const op of ['exists']) {
          const name = column.name + '_' + op;
          fields[name] = { type: graphql.GraphQLBoolean };
        }
        for (const op of ['in']) {
          const name = column.name + '_' + op;
          fields[name] = { type: new graphql.GraphQLList(fieldType) };
        }
        if (fieldType === graphql.GraphQLString) {
          const name = column.name + '_like';
          fields[name] = { type: fieldType };
        }
      }
      const whereType = new graphql.GraphQLInputObjectType({
        name: table._names.pascal + 'WhereType',
        fields() {
          return fields;
        }
      });
      fields['AND'] = { type: new graphql.GraphQLList(whereType) };
      fields['OR'] = { type: new graphql.GraphQLList(whereType) };
      fields['NOT'] = { type: new graphql.GraphQLList(whereType) };
      whereTypes[table.name] = whereType;
      whereFields[table.name] = fields;
    }

    this.uniqueWhereTypes = {};

    for (const table of this.db.tables) {
      const fields = {};
      for (const index of table.indexes) {
        if (index.columns.length == 1) {
          const column = table._column(index.columns[0]);
          fields[column.name] = { type: getType(column.type) };
        } else {
          // TODO: Move to model.js
          const name = snakeToPascal(
            index.name || index.columns.sort().join('_')
          );
          const indexFields = {};
          for (const name of index.columns) {
            const column = table._column(name);
            indexFields[column.name] = { type: getType(column) };
          }
          const indexType = new graphql.GraphQLInputObjectType({
            name: table._names.pascal + name + 'InputType',
            fields: indexFields
          });
          fields[name] = { type: indexType };
        }
      }
      const uniqueWhereType = new graphql.GraphQLInputObjectType({
        name: table._names.pascal + 'UniqueWhereType',
        fields() {
          return fields;
        }
      });
      this.uniqueWhereTypes[table.name] = uniqueWhereType;
    }

    for (const table of this.db.tables) {
      modelFields[table.name] = {};
      for (const column of table.columns) {
        modelFields[table.name][column.name] = { type: getType(column.type) };
        if (column.references) {
          modelFields[table.name][column.foreignName] = {
            type: modelTypes[column.references.table.name],
            resolve(obj, args, req) {
              return req.loader.load(column.references, obj[column.name]);
            }
          };
          whereFields[table.name][column.foreignName] = {
            type: whereTypes[column.references.table.name]
          };
        }
        column.referencedBy.forEach(col => {
          let fieldName, type;
          if (col.unique) {
            fieldName = snakeToCamel(col.table.name);
            type = modelTypes[col.table.name];
          } else {
            fieldName = col.relatedName;
            type = new graphql.GraphQLList(modelTypes[col.table.name]);
          }
          if (modelFields[table.name][fieldName]) {
            throw new Error(`Bad related name: '${fieldName}'`);
          }
          modelFields[table.name][fieldName] = {
            type,
            args: {
              where: { type: whereTypes[col.table.name] },
              ...QueryOptions
            },
            resolve(object, args, context) {
              if (args.where) {
                args.where[col.name] = object[column.name];
                return context.loader.query(col.table, args);
              } else {
                return context.loader.load(col, object[column.name]);
              }
            }
          };
          for (const op of ['some', 'none']) {
            const fieldName = col.relatedName + '_' + op;
            whereFields[table.name][fieldName] = {
              type: whereTypes[col.table.name]
            };
          }
        });
      }
    }

    const queryFields = {};

    for (const table of this.db.tables) {
      const name = table._names.plural;
      queryFields[name] = {
        type: new graphql.GraphQLList(modelTypes[table.name]),
        args: { where: { type: whereTypes[table.name] }, ...QueryOptions },
        resolve(_, args, context) {
          return context.loader.query(table, args);
        }
      };
      queryFields[table.name] = {
        type: modelTypes[table.name],
        args: { where: { type: this.uniqueWhereTypes[table.name] } },
        resolve(_, args, context) {
          return new Promise(resolve => {
            context.loader.query(table, args).then(rows => {
              if (rows.length > 1) {
                resolve(Error('Internal error: unique constraint not met'));
              } else {
                resolve(rows[0]);
              }
            });
          });
        }
      };
    }

    const schema = new graphql.GraphQLSchema({
      query: new graphql.GraphQLObjectType({
        name: 'Query',
        fields: queryFields
      }),
      mutation: new graphql.GraphQLObjectType({
        name: 'Mutation',
        fields: this.buildMutationFields()
      })
    });

    require('fs').writeFileSync('schema.graphql', graphql.printSchema(schema));

    return schema;
  }

  buildMutationFields() {
    const inputTypesCreate = {};
    const inputTypesUpdate = {};

    const inputFieldsCreate = {};
    const inputFieldsUpdate = {};

    for (const table of this.db.tables) {
      // Create a new object
      const inputType = new graphql.GraphQLInputObjectType({
        name: table._names.pascal + 'InputType',
        fields() {
          return inputFieldsCreate[table.name];
        }
      });

      inputTypesCreate[table.name] = inputType;

      // Update an existing object
      const inputTypeUpdate = new graphql.GraphQLInputObjectType({
        name: table._names.pascal + 'UpdateInputType',
        fields() {
          return inputFieldsUpdate[table.name];
        }
      });

      inputTypesUpdate[table.name] = inputTypeUpdate;
    }

    const connectCreateInputTypes = {};
    const uniqueWhereTypes = this.uniqueWhereTypes;

    for (const table of this.db.tables) {
      // Connect to an existing/Create a new object
      const inputType = new graphql.GraphQLInputObjectType({
        name: table._names.pascal + 'ConnectCreateInputType',
        fields() {
          return {
            connect: { type: uniqueWhereTypes[table.name] },
            create: { type: inputTypesCreate[table.name] }
          };
        }
      });
      connectCreateInputTypes[table.name] = inputType;
    }

    const connectCreateUpdateInputTypesParent = {};

    for (const table of this.db.tables) {
      const typeName =
        table._names.pascal + 'ConnectCreateUpdateInputTypeParent';
      const inputType = new graphql.GraphQLInputObjectType({
        name: typeName,
        fields() {
          return {
            connect: { type: uniqueWhereTypes[table.name] },
            create: { type: inputTypesCreate[table.name] },
            update: { type: inputTypesUpdate[table.name] }
          };
        }
      });
      connectCreateUpdateInputTypesParent[table.name] = inputType;
    }

    const updateOneTypes = {};

    for (const table of this.db.tables) {
      const typeName = table._names.pascal + 'UpdateOneInputType';
      const inputType = new graphql.GraphQLInputObjectType({
        name: typeName,
        fields() {
          return {
            where: { type: uniqueWhereTypes[table.name] },
            data: { type: inputTypesUpdate[table.name] }
          };
        }
      });
      updateOneTypes[table.name] = inputType;
    }

    const upsertTypes = {};

    for (const table of this.db.tables) {
      const typeName = table._names.pascal + 'UpsertInputType';
      const inputType = new graphql.GraphQLInputObjectType({
        name: typeName,
        fields() {
          return {
            create: { type: inputTypesCreate[table.name] },
            update: { type: inputTypesUpdate[table.name] }
          };
        }
      });
      upsertTypes[table.name] = inputType;
    }

    const setTypes = {};

    for (const table of this.db.tables) {
      const typeName = table._names.pascal + 'SetChildInputType';
      const inputType = new graphql.GraphQLInputObjectType({
        name: typeName,
        fields() {
          return {
            connect: {
              type: new graphql.GraphQLList(uniqueWhereTypes[table.name])
            },
            create: {
              type: new graphql.GraphQLList(inputTypesCreate[table.name])
            },
            upsert: {
              type: new graphql.GraphQLList(upsertTypes[table.name])
            }
          };
        }
      });
      setTypes[table.name] = inputType;
    }

    const connectCreateUpdateInputTypesChild = {};

    for (const table of this.db.tables) {
      const typeName =
        table._names.pascal + 'ConnectCreateUpdateInputTypeChild';
      const inputType = new graphql.GraphQLInputObjectType({
        name: typeName,
        fields() {
          return {
            connect: {
              type: new graphql.GraphQLList(uniqueWhereTypes[table.name])
            },
            create: {
              type: new graphql.GraphQLList(inputTypesCreate[table.name])
            },
            update: {
              type: new graphql.GraphQLList(updateOneTypes[table.name])
            },
            upsert: {
              type: new graphql.GraphQLList(upsertTypes[table.name])
            },
            delete: {
              type: new graphql.GraphQLList(uniqueWhereTypes[table.name])
            },
            set: {
              type: setTypes[table.name]
            }
          };
        }
      });
      connectCreateUpdateInputTypesChild[table.name] = inputType;
    }

    for (const table of this.db.tables) {
      inputFieldsCreate[table.name] = {};
      inputFieldsUpdate[table.name] = {};
      for (const column of table.columns) {
        inputFieldsUpdate[table.name][column.name] = {
          type: getType(column.type)
        };
        if (column.references) {
          inputFieldsCreate[table.name][column.name] = {
            type: getType(column.type)
          };
          inputFieldsCreate[table.name][column.foreignName] = {
            type: connectCreateInputTypes[column.references.table.name]
          };
          inputFieldsUpdate[table.name][column.foreignName] = {
            type:
              connectCreateUpdateInputTypesParent[column.references.table.name]
          };
        } else {
          inputFieldsCreate[table.name][column.name] = {
            type: getType(column)
          };
        }
        column.referencedBy.forEach(col => {
          const fieldName = col.relatedName;
          const type = connectCreateUpdateInputTypesChild[col.table.name];
          inputFieldsUpdate[table.name][fieldName] = { type };
          inputFieldsCreate[table.name][fieldName] = { type };
        });
      }
    }

    const mutationFields = {};

    for (const table of this.db.tables) {
      const name = 'create' + table._names.pascal;
      mutationFields[name] = {
        type: this.modelTypes[table.name],
        args: { data: { type: inputTypesCreate[table.name] } },
        resolve(_, args, context) {
          return context.loader.create(table, args);
        }
      };
    }

    for (const table of this.db.tables) {
      const name = 'update' + table._names.pascal;
      mutationFields[name] = {
        type: this.modelTypes[table.name],
        args: updateOneTypes[table.name].getFields(),
        resolve(_, args, context) {
          return context.loader.update(table, args);
        }
      };
    }

    for (const table of this.db.tables) {
      const name = 'upsert' + table._names.pascal;
      mutationFields[name] = {
        type: this.modelTypes[table.name],
        args: upsertTypes[table.name].getFields(),
        resolve(_, args, context) {
          return context.loader.upsert(table, args);
        }
      };
    }

    for (const table of this.db.tables) {
      const name = 'delete' + table._names.pascal;
      mutationFields[name] = {
        type: this.modelTypes[table.name],
        args: {
          where: { type: uniqueWhereTypes[table.name] }
        },
        resolve(_, args, context) {
          return context.loader.delete(table, args);
        }
      };
    }

    return mutationFields;
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
  } else if (/^datetime$/i.test(type)) {
    return GraphQLDateTime;
  } else if (/^date$/i.test(type)) {
    return GraphQLDate;
  } else if (/^time$/i.test(type)) {
    return GraphQLTime;
  }

  return graphql.GraphQLString;
}

function getInputType(column) {
  const type = getType(column.type);
  return column.nullable || column.autoIncrement
    ? type
    : new graphql.GraphQLNonNull(type);
}

function createSchema(data, options) {
  const builder = new Builder(data, options);
  return builder.build();
}

module.exports = { createSchema };
