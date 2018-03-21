import {
  GraphQLScalarType,
  GraphQLBoolean,
  GraphQLInt,
  GraphQLFloat,
  GraphQLString,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLList,
  GraphQLInputObjectType,
  GraphQLSchema,
  GraphQLFieldConfigMap,
  printSchema
} from 'graphql';

import { Schema, SimpleField, ForeignKeyField, RelatedField } from './model';

const QueryOptions = {
  limit: { type: GraphQLInt },
  offset: { type: GraphQLInt },
  orderBy: { type: GraphQLString }
};

interface Context {
  loader: any;
}

class Builder {
  schema: Schema;

  modelTypes: { [key: string]: GraphQLObjectType };
  modelFields: {
    [key: string]: GraphQLFieldConfigMap<any, Context>;
  };

  constructor(schema: Schema | any, options: any) {
    if (!(schema instanceof Schema)) {
      schema = new Schema(schema, options);
    }

    this.schema = schema;

    const modelTypes: { [key: string]: GraphQLObjectType } = {};
    const modelFields: {
      [key: string]: GraphQLFieldConfigMap<any, Context>;
    } = {};

    this.modelTypes = modelTypes;
    this.modelFields = modelFields;

    for (const model of this.schema.models) {
      const modelType = new GraphQLObjectType({
        name: model.name,
        fields(): GraphQLFieldConfigMap<any, Context> {
          return modelFields[model.name];
        }
      });
      modelTypes[model.name] = modelType;
    }
  }

  build() {
    const whereTypes = {};
    const whereFields = {};

    for (const model of this.schema.models) {
      const fields = {};
      for (const column of model.fields) {
        const fieldType = getType(column.type);
        fields[column.name] = { type: fieldType };
        for (const op of ['lt', 'le', 'ge', 'gt', 'ne']) {
          const name = column.name + '_' + op;
          fields[name] = { type: fieldType };
        }
        for (const op of ['exists']) {
          const name = column.name + '_' + op;
          fields[name] = { type: GraphQLBoolean };
        }
        for (const op of ['in']) {
          const name = column.name + '_' + op;
          fields[name] = { type: new GraphQLList(fieldType) };
        }
        if (fieldType === GraphQLString) {
          const name = column.name + '_like';
          fields[name] = { type: fieldType };
        }
      }
      const whereType = new GraphQLInputObjectType({
        name: model._names.pascal + 'WhereType',
        fields() {
          return fields;
        }
      });
      fields['AND'] = { type: new GraphQLList(whereType) };
      fields['OR'] = { type: new GraphQLList(whereType) };
      fields['NOT'] = { type: new GraphQLList(whereType) };
      whereTypes[model.name] = whereType;
      whereFields[model.name] = fields;
    }

    const uniqueWhereTypes: { [key: string]: GraphQLInputObjectType } = {};

    for (const table of this.schema.tables) {
      const fields = {};
      for (const index of table.indexes) {
        for (const name of index.columns) {
          const column = table._column(name);
          fields[column.name] = { type: getType(column.type) };
        }
      }
      const uniqueWhereType = new GraphQLInputObjectType({
        name: table._names.pascal + 'UniqueWhereType',
        fields() {
          return fields;
        }
      });
      uniqueWhereTypes[table.name] = uniqueWhereType;
    }

    const modelTypes = this.modelTypes;
    const modelFields = this.modelFields;

    for (const model of this.schema.models) {
      modelFields[model.name] = {};
      for (const field of model.fields) {
        if (field instanceof ForeignKeyField) {
          modelFields[model.name][field.name] = {
            type: modelTypes[field.referencedField.model.name],
            resolve(obj, args, req) {
              return req.loader.load(field.referencedField, obj[field.name]);
            }
          };
          whereFields[model.name][field.name] = {
            type: whereTypes[field.referencedField.model.name]
          };
        } else if (field instanceof SimpleField) {
          modelFields[model.name][field.name] = {
            type: getType(field.column.type)
          };
        } else {
          const relatedField = field as RelatedField;

          let fieldName = relatedField.name;
          let type = modelTypes[relatedField.referencingField.model.name];

          if (field.unique) {
            fieldName = snakeToCamel(col.table.name);
            type = new GraphQLList(type);
            type = modelTypes[relatedField.referencingField.model.name];
          } else {
            fieldName = col.relatedName;
            type = new GraphQLList();
          }
        }

        field.referencedBy.forEach(col => {
          let fieldName, type;
          if (col.unique) {
            fieldName = snakeToCamel(col.table.name);
            type = modelTypes[col.table.name];
          } else {
            fieldName = col.relatedName;
            type = new GraphQLList(modelTypes[col.table.name]);
          }

          if (modelFields[model.name][fieldName]) {
            throw new Error(`Bad related name: '${fieldName}'`);
          }

          modelFields[model.name][fieldName] = {
            type,
            args: {
              where: { type: whereTypes[col.table.name] },
              ...QueryOptions
            },
            resolve(object, args, context) {
              if (args.where) {
                args.where[col.name] = object[field.name];
                return context.loader.query(col.table, args);
              } else {
                return context.loader.load(col, object[field.name]);
              }
            }
          };
          for (const op of ['some', 'none']) {
            const fieldName = col.relatedName + '_' + op;
            whereFields[model.name][fieldName] = {
              type: whereTypes[col.table.name]
            };
          }
        });
      }
    }

    const queryFields = {};

    for (const table of this.schema.tables) {
      const name = table._names.plural;
      queryFields[name] = {
        type: new GraphQLList(modelTypes[table.name]),
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

    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Query',
        fields: queryFields
      }),
      mutation: new GraphQLObjectType({
        name: 'Mutation',
        fields: this.buildMutationFields()
      })
    });

    // require('fs').writeFileSync('schema.graphql', printSchema(schema));

    return schema;
  }

  buildMutationFields() {
    const inputTypesCreate = {};
    const inputTypesUpdate = {};

    const inputFieldsCreate = {};
    const inputFieldsUpdate = {};

    for (const table of this.schema.tables) {
      // Create a new object
      const inputType = new GraphQLInputObjectType({
        name: table._names.pascal + 'InputType',
        fields() {
          return inputFieldsCreate[table.name];
        }
      });

      inputTypesCreate[table.name] = inputType;

      // Update an existing object
      const inputTypeUpdate = new GraphQLInputObjectType({
        name: table._names.pascal + 'UpdateInputType',
        fields() {
          return inputFieldsUpdate[table.name];
        }
      });

      inputTypesUpdate[table.name] = inputTypeUpdate;
    }

    const connectCreateInputTypes = {};
    const uniqueWhereTypes = this.uniqueWhereTypes;

    for (const table of this.schema.tables) {
      // Connect to an existing/Create a new object
      const inputType = new GraphQLInputObjectType({
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

    for (const table of this.schema.tables) {
      const typeName =
        table._names.pascal + 'ConnectCreateUpdateInputTypeParent';
      const inputType = new GraphQLInputObjectType({
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

    for (const table of this.schema.tables) {
      const typeName = table._names.pascal + 'UpdateOneInputType';
      const inputType = new GraphQLInputObjectType({
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

    for (const table of this.schema.tables) {
      const typeName = table._names.pascal + 'UpsertInputType';
      const inputType = new GraphQLInputObjectType({
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

    for (const table of this.schema.tables) {
      const typeName = table._names.pascal + 'SetChildInputType';
      const inputType = new GraphQLInputObjectType({
        name: typeName,
        fields() {
          return {
            connect: {
              type: new GraphQLList(uniqueWhereTypes[table.name])
            },
            create: {
              type: new GraphQLList(inputTypesCreate[table.name])
            },
            upsert: {
              type: new GraphQLList(upsertTypes[table.name])
            }
          };
        }
      });
      setTypes[table.name] = inputType;
    }

    const connectCreateUpdateInputTypesChild = {};

    for (const table of this.schema.tables) {
      const typeName =
        table._names.pascal + 'ConnectCreateUpdateInputTypeChild';
      const inputType = new GraphQLInputObjectType({
        name: typeName,
        fields() {
          return {
            connect: {
              type: new GraphQLList(uniqueWhereTypes[table.name])
            },
            create: {
              type: new GraphQLList(inputTypesCreate[table.name])
            },
            update: {
              type: new GraphQLList(updateOneTypes[table.name])
            },
            upsert: {
              type: new GraphQLList(upsertTypes[table.name])
            },
            delete: {
              type: new GraphQLList(uniqueWhereTypes[table.name])
            },
            set: {
              type: setTypes[table.name]
            }
          };
        }
      });
      connectCreateUpdateInputTypesChild[table.name] = inputType;
    }

    for (const table of this.schema.tables) {
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

    for (const table of this.schema.tables) {
      const name = 'create' + table._names.pascal;
      mutationFields[name] = {
        type: this.modelTypes[table.name],
        args: { data: { type: inputTypesCreate[table.name] } },
        resolve(_, args, context) {
          return context.loader.create(table, args);
        }
      };
    }

    for (const table of this.schema.tables) {
      const name = 'update' + table._names.pascal;
      mutationFields[name] = {
        type: this.modelTypes[table.name],
        args: updateOneTypes[table.name].getFields(),
        resolve(_, args, context) {
          return context.loader.update(table, args);
        }
      };
    }

    for (const table of this.schema.tables) {
      const name = 'upsert' + table._names.pascal;
      mutationFields[name] = {
        type: this.modelTypes[table.name],
        args: upsertTypes[table.name].getFields(),
        resolve(_, args, context) {
          return context.loader.upsert(table, args);
        }
      };
    }

    for (const table of this.schema.tables) {
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

function getType(type: string): GraphQLScalarType {
  if (/char|text/i.test(type)) {
    return GraphQLString;
  } else if (/^int/i.test(type)) {
    return GraphQLInt;
  } else if (/float|double/i.test(type)) {
    return GraphQLFloat;
  } else if (/^bool/i.test(type)) {
    return GraphQLBoolean;
  }
  return GraphQLString;
}

function getInputType(column) {
  const type = getType(column.type);
  return column.nullable || column.autoIncrement
    ? type
    : new GraphQLNonNull(type);
}

function createSchema(data, options) {
  const builder = new Builder(data, options);
  return builder.build();
}

module.exports = { createSchema };
