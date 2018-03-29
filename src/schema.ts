import {
  GraphQLScalarType,
  GraphQLBoolean,
  GraphQLInt,
  GraphQLFloat,
  GraphQLString,
  GraphQLInputType,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLList,
  GraphQLInputObjectType,
  GraphQLInputFieldConfigMap,
  GraphQLSchema,
  GraphQLFieldConfigMap,
  printSchema
} from 'graphql';

import {
  Schema,
  SimpleField,
  ForeignKeyField,
  RelatedField,
  Field
} from './model';

interface ObjectTypeMap {
  [key: string]: GraphQLObjectType;
}

interface ObjectFieldsMap {
  [key: string]: GraphQLFieldConfigMap<any, QueryContext>;
}

interface InputTypeMap {
  [key: string]: GraphQLInputObjectType;
}

interface InputFieldsMap {
  [key: string]: GraphQLInputFieldConfigMap;
}

interface QueryContext {
  loader: any;
}

const QueryOptions = {
  limit: { type: GraphQLInt },
  offset: { type: GraphQLInt },
  orderBy: { type: GraphQLString }
};

class SchemaBuilder {
  private domain: Schema;
  private schema: GraphQLSchema;

  private modelTypeMap: ObjectTypeMap = {};
  private whereTypeMap: InputTypeMap = {};
  private uniqueTypeMap: InputTypeMap = {};

  constructor(domain: Schema) {
    this.domain = domain;

    this.createWhereTypes();
    this.createModelTypes();

    const queryFields = this.createQueryFields();
    const mutationFields = this.createMutationFields();

    this.schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Query',
        fields: queryFields
      }),
      mutation: new GraphQLObjectType({
        name: 'Mutation',
        fields: mutationFields
      })
    });
  }

  createWhereTypes() {
    const whereFieldsMap: InputFieldsMap = {};
    const uniqueFieldsMap: InputFieldsMap = {};

    for (const model of this.domain.models) {
      const whereFields: GraphQLInputFieldConfigMap = {};
      const uniqueFields: GraphQLInputFieldConfigMap = {};

      for (const field of model.fields) {
        if (field instanceof SimpleField) {
          if (!(field instanceof ForeignKeyField)) {
            const type = getType(field.column.type);
            whereFields[field.name] = { type: type };
            for (const op of ['lt', 'le', 'ge', 'gt', 'ne']) {
              const name = field.name + '_' + op;
              whereFields[name] = { type };
            }
            for (const op of ['exists']) {
              const name = field.name + '_' + op;
              whereFields[name] = { type: GraphQLBoolean };
            }
            for (const op of ['in']) {
              const name = field.name + '_' + op;
              whereFields[name] = { type: new GraphQLList(type) };
            }
            if (type === GraphQLString) {
              const name = field.name + '_like';
              whereFields[name] = { type };
            }
            if (field.uniqueKey) {
              uniqueFields[field.name] = { type: type };
            }
          }
        }
      }

      const whereType = new GraphQLInputObjectType({
        name: model.name + 'WhereType',
        fields() {
          return whereFields;
        }
      });

      whereFields['AND'] = { type: new GraphQLList(whereType) };
      whereFields['OR'] = { type: new GraphQLList(whereType) };
      whereFields['NOT'] = { type: new GraphQLList(whereType) };

      const uniqueType = new GraphQLInputObjectType({
        name: model.name + 'UniqueWhereType',
        fields() {
          return uniqueFields;
        }
      });

      this.whereTypeMap[model.name] = whereType;
      whereFieldsMap[model.name] = whereFields;

      this.uniqueTypeMap[model.name] = uniqueType;
      uniqueFieldsMap[model.name] = uniqueFields;
    }

    for (const model of this.domain.models) {
      for (const field of model.fields) {
        if (field instanceof ForeignKeyField) {
          whereFieldsMap[model.name][field.name] = {
            type: this.whereTypeMap[field.referencedField.model.name]
          };
          if (field.uniqueKey) {
            uniqueFieldsMap[model.name][field.name] = {
              type: this.uniqueTypeMap[field.referencedField.model.name]
            };
          }
        } else if (field instanceof RelatedField) {
          for (const op of ['some', 'none']) {
            const name = field.name + '_' + op;
            whereFieldsMap[model.name][name] = {
              type: this.whereTypeMap[field.model.name]
            };
          }
        }
      }
    }
  }

  createModelTypes() {
    const modelFieldsMap: ObjectFieldsMap = {};

    for (const model of this.domain.models) {
      this.modelTypeMap[model.name] = new GraphQLObjectType({
        name: model.name,
        fields(): GraphQLFieldConfigMap<any, QueryContext> {
          return modelFieldsMap[model.name];
        }
      });
      modelFieldsMap[model.name] = {};
    }

    const modelTypeMap = this.modelTypeMap;
    const whereTypeMap = this.whereTypeMap;

    for (const model of this.domain.models) {
      const modelFields = modelFieldsMap[model.name];
      for (const field of model.fields) {
        if (field instanceof ForeignKeyField) {
          modelFields[field.name] = {
            type: modelTypeMap[field.referencedField.model.name],
            resolve(obj, args, req) {
              return req.loader.load(field.referencedField, obj[field.name]);
            }
          };
        } else if (field instanceof SimpleField) {
          modelFields[field.name] = {
            type: getType(field.column.type)
          };
        } else {
          const related = (field as RelatedField).referencingField;
          const modelType = modelTypeMap[related.model.name];
          const type = related.isUnique()
            ? modelType
            : new GraphQLList(modelType);
          modelFields[field.name] = {
            type,
            args: {
              where: { type: whereTypeMap[related.model.name] },
              ...QueryOptions
            },
            resolve(object, args, context) {
              if (args.where) {
                args.where[related.column.name] = object[field.name];
                return context.loader.query(related.model.table.name, args);
              } else {
                return context.loader.load(related, object[field.name]);
              }
            }
          };
        }
      }
    }
  }

  createQueryFields() {
    const queryFields = {};

    for (const model of this.domain.models) {
      queryFields[model.pluralName] = {
        type: new GraphQLList(this.modelTypeMap[model.name]),
        args: {
          where: { type: this.whereTypeMap[model.name] },
          ...QueryOptions
        },
        resolve(_, args, context) {
          return context.loader.query(model, args);
        }
      };
      const name = model.name.charAt(0).toLowerCase() + model.name.slice(1);
      queryFields[name] = {
        type: this.modelTypeMap[model.name],
        args: { where: { type: this.uniqueTypeMap[model.name] } },
        resolve(_, args, context) {
          return new Promise(resolve => {
            // TODO: Check if args meets at least one unique constraint
            context.loader.query(model, args).then(rows => {
              if (rows.length > 1) {
                resolve(Error('Internal error: not unique'));
              } else {
                resolve(rows[0]);
              }
            });
          });
        }
      };
    }

    return queryFields;
  }

  createMutationFields(): GraphQLFieldConfigMap<any, QueryContext> {
    const uniqueTypeMap = this.uniqueTypeMap;

    const inputTypesCreate: InputTypeMap = {};
    const inputTypesUpdate: InputTypeMap = {};

    const inputFieldsCreate: InputFieldsMap = {};
    const inputFieldsUpdate: InputFieldsMap = {};

    for (const model of this.domain.models) {
      // Create a new object
      const inputType = new GraphQLInputObjectType({
        name: model.name + 'InputType',
        fields() {
          return inputFieldsCreate[model.name];
        }
      });

      inputTypesCreate[model.name] = inputType;

      // Update an existing object
      const inputTypeUpdate = new GraphQLInputObjectType({
        name: model.name + 'UpdateInputType',
        fields() {
          return inputFieldsUpdate[model.name];
        }
      });

      inputTypesUpdate[model.name] = inputTypeUpdate;
    }

    const connectCreateInputTypes = {};

    for (const model of this.domain.models) {
      // Connect to an existing/Create a new object
      const inputType = new GraphQLInputObjectType({
        name: model.name + 'ConnectCreateInputType',
        fields() {
          return {
            connect: { type: uniqueTypeMap[model.name] },
            create: { type: inputTypesCreate[model.name] }
          };
        }
      });
      connectCreateInputTypes[model.name] = inputType;
    }

    const connectCreateUpdateInputTypesParent = {};

    for (const model of this.domain.models) {
      const typeName = model.name + 'ConnectCreateUpdateInputTypeParent';
      const inputType = new GraphQLInputObjectType({
        name: typeName,
        fields() {
          return {
            connect: { type: uniqueTypeMap[model.name] },
            create: { type: inputTypesCreate[model.name] },
            update: { type: inputTypesUpdate[model.name] }
          };
        }
      });
      connectCreateUpdateInputTypesParent[model.name] = inputType;
    }

    const updateOneTypes = {};

    for (const model of this.domain.models) {
      const typeName = model.name + 'UpdateOneInputType';
      const inputType = new GraphQLInputObjectType({
        name: typeName,
        fields() {
          return {
            where: { type: uniqueTypeMap[model.name] },
            data: { type: inputTypesUpdate[model.name] }
          };
        }
      });
      updateOneTypes[model.name] = inputType;
    }

    const upsertTypes = {};

    for (const model of this.domain.models) {
      const typeName = model.name + 'UpsertInputType';
      const inputType = new GraphQLInputObjectType({
        name: typeName,
        fields() {
          return {
            create: { type: inputTypesCreate[model.name] },
            update: { type: inputTypesUpdate[model.name] }
          };
        }
      });
      upsertTypes[model.name] = inputType;
    }

    const setTypes = {};

    for (const model of this.domain.models) {
      const typeName = model.name + 'InputTypeChild';
      const inputType = new GraphQLInputObjectType({
        name: typeName,
        fields() {
          return {
            connect: {
              type: new GraphQLList(uniqueTypeMap[model.name])
            },
            create: {
              type: new GraphQLList(inputTypesCreate[model.name])
            },
            upsert: {
              type: new GraphQLList(upsertTypes[model.name])
            }
          };
        }
      });
      setTypes[model.name] = inputType;
    }

    const connectCreateUpdateInputTypesChild = {};

    for (const model of this.domain.models) {
      const typeName = model.name + 'ConnectCreateUpdateInputTypeChild';
      const inputType = new GraphQLInputObjectType({
        name: typeName,
        fields() {
          return {
            connect: {
              type: new GraphQLList(uniqueTypeMap[model.name])
            },
            create: {
              type: new GraphQLList(inputTypesCreate[model.name])
            },
            update: {
              type: new GraphQLList(updateOneTypes[model.name])
            },
            upsert: {
              type: new GraphQLList(upsertTypes[model.name])
            },
            delete: {
              type: new GraphQLList(uniqueTypeMap[model.name])
            },
            // TODO: Add disconnect
            set: {
              type: setTypes[model.name]
            }
          };
        }
      });
      connectCreateUpdateInputTypesChild[model.name] = inputType;
    }

    for (const model of this.domain.models) {
      inputFieldsCreate[model.name] = {};
      inputFieldsUpdate[model.name] = {};
      for (const field of model.fields) {
        if (field instanceof ForeignKeyField) {
          inputFieldsCreate[model.name][field.name] = {
            type: connectCreateInputTypes[field.referencedField.model.name]
          };
          inputFieldsUpdate[model.name][field.name] = {
            type:
              connectCreateUpdateInputTypesParent[
                field.referencedField.model.name
              ]
          };
        } else if (field instanceof SimpleField) {
          inputFieldsCreate[model.name][field.name] = {
            type: getInputType(field)
          };
          inputFieldsUpdate[model.name][field.name] = {
            type: getType(field.column.type)
          };
        } else {
          const related = (field as RelatedField).referencingField;
          const type = connectCreateUpdateInputTypesChild[related.model.name];
          inputFieldsUpdate[model.name][field.name] = { type };
          inputFieldsCreate[model.name][field.name] = { type };
        }
      }
    }

    const mutationFields: GraphQLFieldConfigMap<any, QueryContext> = {};

    for (const model of this.domain.models) {
      const name = 'create' + model.name;
      mutationFields[name] = {
        type: this.modelTypeMap[model.name],
        args: { data: { type: inputTypesCreate[model.name] } },
        resolve(_, args, context) {
          return context.loader.create(model, args);
        }
      };
    }

    for (const model of this.domain.models) {
      const name = 'update' + model.name;
      mutationFields[name] = {
        type: this.modelTypeMap[model.name],
        args: updateOneTypes[model.name].getFields(),
        resolve(_, args, context) {
          return context.loader.update(model, args);
        }
      };
    }

    for (const model of this.domain.models) {
      const name = 'upsert' + model.name;
      mutationFields[name] = {
        type: this.modelTypeMap[model.name],
        args: upsertTypes[model.name].getFields(),
        resolve(_, args, context) {
          return context.loader.upsert(model, args);
        }
      };
    }

    for (const model of this.domain.models) {
      const name = 'delete' + model.name;
      mutationFields[name] = {
        type: this.modelTypeMap[model.name],
        args: {
          where: { type: uniqueTypeMap[model.name] }
        },
        resolve(_, args, context) {
          return context.loader.delete(model, args);
        }
      };
    }

    return mutationFields;
  }

  getSchema(): GraphQLSchema {
    return this.schema;
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

function getInputType(field: SimpleField): GraphQLInputType {
  const type = getType(field.column.type);
  return field.column.nullable || field.column.autoIncrement
    ? type
    : new GraphQLNonNull(type);
}

export function createSchema(data, config = undefined): GraphQLSchema {
  const builder = new SchemaBuilder(new Schema(data, config));
  return builder.getSchema();
}
