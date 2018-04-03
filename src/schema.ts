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
  Model,
  SimpleField,
  ForeignKeyField,
  RelatedField,
  Field
} from './model';

import { Accessor } from './accessor';
import { AND, OR, NOT } from './filter';
import { toPascalCase } from './misc';

interface ObjectTypeMap {
  [key: string]: GraphQLObjectType;
}

interface ObjectFieldsMap {
  [key: string]: GraphQLFieldConfigMap<any, QueryContext>;
}

interface InputTypeMap {
  [key: string]: GraphQLInputObjectType;
}

interface InputTypeMapEx {
  [key: string]: {
    [key: string]: GraphQLInputObjectType;
  };
}

interface InputFieldsMap {
  [key: string]: GraphQLInputFieldConfigMap;
}

interface InputFieldsMapEx {
  [key: string]: {
    [key: string]: GraphQLInputFieldConfigMap;
  };
}

interface QueryContext {
  accessor: Accessor;
}

const QueryOptions = {
  limit: { type: GraphQLInt },
  offset: { type: GraphQLInt },
  orderBy: { type: GraphQLString }
};

export class SchemaBuilder {
  private domain: Schema;
  private schema: GraphQLSchema;

  private modelTypeMap: ObjectTypeMap = {};
  private modelTypeMapEx = {};

  private whereTypeMap: InputTypeMap = {};
  private whereTypeMapEx = {};

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
        name: getWhereTypeName(model),
        fields() {
          return whereFields;
        }
      });

      whereFields[AND] = { type: new GraphQLList(whereType) };
      whereFields[OR] = { type: new GraphQLList(whereType) };
      whereFields[NOT] = { type: new GraphQLList(whereType) };

      const uniqueType = new GraphQLInputObjectType({
        name: getUniqueWhereTypeName(model),
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
      this.whereTypeMapEx[model.name] = {};
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
          const whereType = new GraphQLInputObjectType({
            name: getWhereTypeName(model, field),
            fields() {
              const model = field.referencingField.model;
              const fields = {};
              for (const name in whereFieldsMap[model.name]) {
                if (name !== field.referencingField.name) {
                  fields[name] = whereFieldsMap[model.name][name];
                }
              }
              fields[AND] = { type: new GraphQLList(whereType) };
              fields[OR] = { type: new GraphQLList(whereType) };
              fields[NOT] = { type: new GraphQLList(whereType) };
              return fields;
            }
          });

          this.whereTypeMapEx[model.name][field.name] = whereType;

          for (const op of ['some', 'none']) {
            const name = field.name + '_' + op;
            whereFieldsMap[model.name][name] = {
              type: whereType
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
        name: getModelTypeName(model),
        fields(): GraphQLFieldConfigMap<any, QueryContext> {
          return modelFieldsMap[model.name];
        }
      });
      modelFieldsMap[model.name] = {};
    }

    const modelFieldsMapEx = {};

    for (const model of this.domain.models) {
      this.modelTypeMapEx[model.name] = {};
      modelFieldsMapEx[model.name] = {};
      for (const field of model.fields) {
        if (field instanceof RelatedField) {
          this.modelTypeMapEx[model.name][field.name] = new GraphQLObjectType({
            name: getModelTypeName(model, field),
            fields(): GraphQLFieldConfigMap<any, QueryContext> {
              return modelFieldsMapEx[model.name][field.name];
            }
          });
        }
      }
    }

    const modelTypeMap = this.modelTypeMap;
    const modelTypeMapEx = this.modelTypeMapEx;
    const whereTypeMapEx = this.whereTypeMapEx;

    for (const model of this.domain.models) {
      const modelFields = modelFieldsMap[model.name];
      for (const field of model.fields) {
        if (field instanceof ForeignKeyField) {
          modelFields[field.name] = {
            type: modelTypeMap[field.referencedField.model.name],
            resolve(obj, args, req) {
              return req.accessor.load(field.referencedField, obj[field.name]);
            }
          };
        } else if (field instanceof SimpleField) {
          modelFields[field.name] = {
            type: getType(field.column.type)
          };
        } else {
          const modelTypeEx = modelTypeMapEx[model.name][field.name];
          const related = (field as RelatedField).referencingField;
          modelFields[field.name] = {
            type: related.isUnique()
              ? modelTypeEx
              : new GraphQLList(modelTypeEx),
            args: {
              where: { type: whereTypeMapEx[model.name][field.name] },
              ...QueryOptions
            },
            resolve(object, args, context) {
              args.where = args.where || {};
              args.where[related.name] = object[field.name];
              return context.accessor.query(related.model, args);
            }
          };
        }
      }
    }

    for (const model of this.domain.models) {
      for (const field of model.fields) {
        if (field instanceof RelatedField) {
          modelFieldsMapEx[model.name][field.name] = {};
          const related = (field as RelatedField).referencingField;
          for (const name in modelFieldsMap[related.model.name]) {
            if (name !== related.name) {
              modelFieldsMapEx[model.name][field.name][name] =
                modelFieldsMap[related.model.name][name];
            }
          }
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
          return context.accessor.query(model, args);
        }
      };

      const name = model.name.charAt(0).toLowerCase() + model.name.slice(1);
      queryFields[name] = {
        type: this.modelTypeMap[model.name],
        args: { where: { type: this.uniqueTypeMap[model.name] } },
        resolve(_, args, context: QueryContext) {
          return context.accessor.get(model, args);
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

    // model.name => field.name => InputType
    const uniqueTypeMapEx: InputTypeMapEx = {};

    const inputTypesCreateEx: InputTypeMapEx = {};
    const inputTypesUpdateEx: InputTypeMapEx = {};

    // model.name => field.name => fields
    const inputFieldsCreateEx: InputFieldsMapEx = {};
    const inputFieldsUpdateEx: InputFieldsMapEx = {};

    for (const model of this.domain.models) {
      uniqueTypeMapEx[model.name] = {};
      for (const field of model.fields) {
        if (field instanceof RelatedField) {
          const uniqueFields: GraphQLInputFieldConfigMap = {};
          for (const fld of field.referencingField.model.fields) {
            if (fld.uniqueKey && fld != field.referencingField) {
              const type = getType((fld as SimpleField).column.type);
              uniqueFields[fld.name] = { type: type };
            }
          }
          const uniqueType = new GraphQLInputObjectType({
            name: getUniqueWhereTypeName(model, field),
            fields() {
              return uniqueFields;
            }
          });
          uniqueTypeMapEx[model.name][field.name] = uniqueType;
        }
      }
    }

    for (const model of this.domain.models) {
      const inputType = new GraphQLInputObjectType({
        name: getModelInputTypeName(model),
        fields() {
          return inputFieldsCreate[model.name];
        }
      });

      inputTypesCreate[model.name] = inputType;

      const inputTypeUpdate = new GraphQLInputObjectType({
        name: getUpdateInputTypeName(model),
        fields() {
          return inputFieldsUpdate[model.name];
        }
      });

      inputTypesUpdate[model.name] = inputTypeUpdate;

      inputTypesCreateEx[model.name] = {};
      inputTypesUpdateEx[model.name] = {};

      for (const field of model.fields) {
        if (field instanceof RelatedField) {
          const inputType = new GraphQLInputObjectType({
            name: getModelInputTypeName(model, field),
            fields() {
              const model = field.referencingField.model;
              const fields = {};
              for (const name in inputFieldsCreate[model.name]) {
                if (name !== field.referencingField.name) {
                  fields[name] = inputFieldsCreate[model.name][name];
                }
              }
              return fields;
            }
          });

          inputTypesCreateEx[model.name][field.name] = inputType;

          const inputTypeUpdate = new GraphQLInputObjectType({
            name: getUpdateInputTypeName(model, field),
            fields() {
              const model = field.referencingField.model;
              const fields = {};
              for (const name in inputFieldsUpdate[model.name]) {
                if (name !== field.referencingField.name) {
                  fields[name] = inputFieldsUpdate[model.name][name];
                }
              }
              return fields;
            }
          });

          inputTypesUpdateEx[model.name][field.name] = inputTypeUpdate;
        }
      }
    }

    const connectCreateInputTypes = {};

    // when creating a row, parent rows can be created/connected
    for (const model of this.domain.models) {
      const inputType = new GraphQLInputObjectType({
        name: getConnectCreateInputTypeName(model),
        fields() {
          return {
            connect: { type: uniqueTypeMap[model.name] },
            create: { type: inputTypesCreate[model.name] }
          };
        }
      });
      connectCreateInputTypes[model.name] = inputType;
    }

    const connectCreateUpdateInputTypes = {};

    // when updating a row, parent rows can be created/connected/updated
    for (const model of this.domain.models) {
      const inputType = new GraphQLInputObjectType({
        name: getConnectCreateUpdateInputTypeName(model),
        fields() {
          return {
            connect: { type: uniqueTypeMap[model.name] },
            create: { type: inputTypesCreate[model.name] },
            update: { type: inputTypesUpdate[model.name] }
          };
        }
      });
      connectCreateUpdateInputTypes[model.name] = inputType;
    }

    const updateOneTypes = {};
    const updateOneTypesEx = {};

    for (const model of this.domain.models) {
      const inputType = new GraphQLInputObjectType({
        name: getUpdateOneInputTypeName(model),
        fields() {
          return {
            where: { type: uniqueTypeMap[model.name] },
            data: { type: inputTypesUpdate[model.name] }
          };
        }
      });

      updateOneTypes[model.name] = inputType;
      updateOneTypesEx[model.name] = {};

      for (const field of model.fields) {
        if (field instanceof RelatedField) {
          const inputType = new GraphQLInputObjectType({
            name: getUpdateOneInputTypeName(model, field),
            fields() {
              return {
                where: { type: uniqueTypeMapEx[model.name][field.name] },
                data: { type: inputTypesUpdateEx[model.name][field.name] }
              };
            }
          });
          updateOneTypesEx[model.name][field.name] = inputType;
        }
      }
    }

    const upsertTypes = {};
    const upsertTypesEx = {};

    for (const model of this.domain.models) {
      const inputType = new GraphQLInputObjectType({
        name: getUpsertInputTypeName(model),
        fields() {
          return {
            create: { type: inputTypesCreate[model.name] },
            update: { type: inputTypesUpdate[model.name] }
          };
        }
      });
      upsertTypes[model.name] = inputType;
      upsertTypesEx[model.name] = {};

      for (const field of model.fields) {
        if (field instanceof RelatedField) {
          const inputType = new GraphQLInputObjectType({
            name: getUpsertInputTypeName(model, field),
            fields() {
              return {
                create: { type: inputTypesCreateEx[model.name][field.name] },
                update: { type: inputTypesUpdateEx[model.name][field.name] }
              };
            }
          });
          upsertTypesEx[model.name][field.name] = inputType;
        }
      }
    }

    const inputTypesChild = {};
    const inputTypesChildEx = {};

    for (const model of this.domain.models) {
      const typeName = getModelInputTypeChildName(model);
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
            disconnect: {
              type: new GraphQLList(uniqueTypeMap[model.name])
            }
          };
        }
      });

      inputTypesChild[model.name] = inputType;
      inputTypesChildEx[model.name] = {};

      for (const field of model.fields) {
        if (field instanceof RelatedField) {
          const inputType = new GraphQLInputObjectType({
            name: getModelInputTypeChildName(model, field),
            fields() {
              return {
                connect: {
                  type: new GraphQLList(uniqueTypeMap[model.name])
                },
                create: {
                  type: new GraphQLList(
                    inputTypesCreateEx[model.name][field.name]
                  )
                },
                update: {
                  type: new GraphQLList(
                    updateOneTypesEx[model.name][field.name]
                  )
                },
                upsert: {
                  type: new GraphQLList(upsertTypesEx[model.name][field.name])
                },
                delete: {
                  type: new GraphQLList(uniqueTypeMapEx[model.name][field.name])
                },
                disconnect: {
                  type: new GraphQLList(uniqueTypeMapEx[model.name][field.name])
                }
              };
            }
          });
          inputTypesChildEx[model.name][field.name] = inputType;
        }
      }
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
              connectCreateUpdateInputTypes[field.referencedField.model.name]
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
          const type = inputTypesChildEx[model.name][field.name];
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
          return context.accessor.create(model, args);
        }
      };
    }

    for (const model of this.domain.models) {
      const name = 'update' + model.name;
      mutationFields[name] = {
        type: this.modelTypeMap[model.name],
        args: updateOneTypes[model.name].getFields(),
        resolve(_, args, context) {
          return context.accessor.update(model, args);
        }
      };
    }

    for (const model of this.domain.models) {
      const name = 'upsert' + model.name;
      mutationFields[name] = {
        type: this.modelTypeMap[model.name],
        args: upsertTypes[model.name].getFields(),
        resolve(_, args, context) {
          return context.accessor.upsert(model, args);
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
          return context.accessor.delete(model, args);
        }
      };
    }

    return mutationFields;
  }

  getSchema(): GraphQLSchema {
    return this.schema;
  }
}

function _typeName(model: Model, field: Field, suffix: string): string {
  let typeName = model.name;
  if (field) {
    typeName += toPascalCase(field.name);
  }
  return typeName + suffix;
}

function getWhereTypeName(model: Model, field?: Field) {
  return _typeName(model, field, 'Filter');
}

function getUniqueWhereTypeName(model: Model, field?: Field) {
  return _typeName(model, field, 'UniqueFilter');
}

function getModelTypeName(model: Model, field?: Field) {
  return _typeName(model, field, 'Type');
}

function getModelInputTypeName(model: Model, field?: Field) {
  return _typeName(model, field, 'InputType');
}

function getUpdateInputTypeName(model: Model, field?: Field) {
  return _typeName(model, field, 'UpdateInputType');
}

function getConnectCreateInputTypeName(model: Model) {
  return _typeName(model, undefined, 'ConnectCreateInputType');
}

function getConnectCreateUpdateInputTypeName(model: Model) {
  return _typeName(model, undefined, 'ConnectCreateUpdateInputType');
}

function getUpdateOneInputTypeName(model: Model, field?: Field) {
  return _typeName(model, field, 'UpdateOneInputType');
}

function getUpsertInputTypeName(model: Model, field?: Field) {
  return _typeName(model, field, 'UpsertInputType');
}

function getModelInputTypeChildName(model: Model, field?: Field) {
  return _typeName(model, field, 'InputTypeChild');
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
