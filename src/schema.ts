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

import {
  AND,
  OR,
  NOT,
  LT,
  LE,
  GE,
  GT,
  NE,
  IN,
  LIKE,
  NULL,
  SOME,
  NONE
} from './filter';

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

  private filterInputTypeMap: InputTypeMap = {};
  private filterInputTypeMapEx = {};

  private inputTypesConnect: InputTypeMap = {};
  private inputFieldsConnectMap: InputFieldsMap = {};

  private inputTypesConnectEx = {};

  constructor(domain: Schema) {
    this.domain = domain;

    this.createFilterInputTypes();
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

  createFilterInputTypes() {
    const filterInputFieldsMap: InputFieldsMap = {};
    const findInputFieldsMap = this.inputFieldsConnectMap;

    // Step 1. Simple fields
    for (const model of this.domain.models) {
      const filterInputFields: GraphQLInputFieldConfigMap = {};
      const findInputFields: GraphQLInputFieldConfigMap = {};

      for (const field of model.fields) {
        if (field instanceof SimpleField) {
          if (!(field instanceof ForeignKeyField)) {
            const type = getType(field.column.type);
            filterInputFields[field.name] = { type: type };
            for (const op of [LT, LE, GE, GT, NE]) {
              const name = field.name + '_' + op;
              filterInputFields[name] = { type };
            }
            for (const op of [NULL]) {
              const name = field.name + '_' + op;
              filterInputFields[name] = { type: GraphQLBoolean };
            }
            for (const op of [IN]) {
              const name = field.name + '_' + op;
              filterInputFields[name] = { type: new GraphQLList(type) };
            }
            if (type === GraphQLString) {
              const name = field.name + '_' + LIKE;
              filterInputFields[name] = { type };
            }
            if (field.uniqueKey) {
              findInputFields[field.name] = { type: type };
            }
          }
        }
      }

      const filterDataType = new GraphQLInputObjectType({
        name: getFilterInputTypeName(model),
        fields() {
          return filterInputFields;
        }
      });

      filterInputFields[AND] = { type: new GraphQLList(filterDataType) };
      filterInputFields[OR] = { type: new GraphQLList(filterDataType) };
      filterInputFields[NOT] = { type: new GraphQLList(filterDataType) };

      const findDataType = new GraphQLInputObjectType({
        name: getFindInputTypeName(model),
        fields() {
          return findInputFields;
        }
      });

      this.filterInputTypeMap[model.name] = filterDataType;
      filterInputFieldsMap[model.name] = filterInputFields;

      this.inputTypesConnect[model.name] = findDataType;
      findInputFieldsMap[model.name] = findInputFields;
    }

    // Step 2. Foreign key fields
    for (const model of this.domain.models) {
      for (const field of model.fields) {
        if (field instanceof ForeignKeyField) {
          filterInputFieldsMap[model.name][field.name] = {
            type: this.filterInputTypeMap[field.referencedField.model.name]
          };
          if (field.uniqueKey) {
            findInputFieldsMap[model.name][field.name] = {
              type: this.inputTypesConnect[field.referencedField.model.name]
            };
          }
        }
      }
    }

    // Step 3. Related fields
    for (const model of this.domain.models) {
      this.filterInputTypeMapEx[model.name] = {};
      this.inputTypesConnectEx[model.name] = {};
      for (const field of model.fields) {
        if (field instanceof RelatedField) {
          this.filterInputTypeMapEx[model.name][
            field.name
          ] = this.relatedFilterInputType(field, filterInputFieldsMap);

          this.inputTypesConnectEx[model.name][
            field.name
          ] = this.relatedFindInputType(field, findInputFieldsMap);

          for (const op of [SOME, NONE]) {
            const name = field.name + '_' + op;
            filterInputFieldsMap[model.name][name] = {
              type: this.filterInputTypeMapEx[model.name][field.name]
            };
          }
        }
      }
    }
  }

  private relatedFilterInputType(
    field: RelatedField,
    filterInputFieldsMap: InputFieldsMap
  ): GraphQLInputObjectType {
    const fields = _exclude(
      filterInputFieldsMap[field.referencingField.model.name],
      field.referencingField
    );
    const filterInputType = new GraphQLInputObjectType({
      name: getFilterInputTypeName(field.model, field),
      fields() {
        return fields;
      }
    });
    fields[AND] = { type: new GraphQLList(filterInputType) };
    fields[OR] = { type: new GraphQLList(filterInputType) };
    fields[NOT] = { type: new GraphQLList(filterInputType) };
    return filterInputType;
  }

  private relatedFindInputType(
    field: RelatedField,
    findInputFieldsMap: InputFieldsMap
  ): GraphQLInputObjectType {
    if (!field.referencingField.uniqueKey) {
      return this.inputTypesConnect[field.referencingField.model.name];
    }
    const fields = _exclude(
      findInputFieldsMap[field.referencingField.model.name],
      field.referencingField
    );
    return new GraphQLInputObjectType({
      name: getFindInputTypeName(field.model, field),
      fields() {
        return fields;
      }
    });
  }

  createModelTypes() {
    const modelTypeMap = this.modelTypeMap;
    const modelTypeMapEx = {};
    const filterInputTypeMapEx = this.filterInputTypeMapEx;

    const modelFieldsMap: ObjectFieldsMap = {};
    const modelFieldsMapEx = {};

    for (const model of this.domain.models) {
      this.modelTypeMap[model.name] = new GraphQLObjectType({
        name: getModelDataTypeName(model),
        fields(): GraphQLFieldConfigMap<any, QueryContext> {
          return modelFieldsMap[model.name];
        }
      });
      modelFieldsMap[model.name] = {};
    }

    for (const model of this.domain.models) {
      modelTypeMapEx[model.name] = {};
      modelFieldsMapEx[model.name] = {};
      for (const field of model.fields) {
        if (field instanceof RelatedField) {
          modelTypeMapEx[model.name][field.name] = new GraphQLObjectType({
            name: getModelDataTypeName(model, field),
            fields(): GraphQLFieldConfigMap<any, QueryContext> {
              return modelFieldsMapEx[model.name][field.name];
            }
          });
        }
      }
    }

    for (const model of this.domain.models) {
      const modelDataFields = modelFieldsMap[model.name];
      for (const field of model.fields) {
        if (field instanceof ForeignKeyField) {
          modelDataFields[field.name] = {
            type: modelTypeMap[field.referencedField.model.name],
            resolve(obj, args, req) {
              const key = field.referencedField.model.keyField().name;
              return req.accessor.load(
                field.referencedField,
                obj[field.name][key]
              );
            }
          };
        } else if (field instanceof SimpleField) {
          modelDataFields[field.name] = {
            type: getType(field.column.type)
          };
        } else {
          const modelDataTypeEx = modelTypeMapEx[model.name][field.name];
          const related = (field as RelatedField).referencingField;
          modelDataFields[field.name] = {
            type: related.isUnique()
              ? modelDataTypeEx
              : new GraphQLList(modelDataTypeEx),
            args: {
              where: { type: filterInputTypeMapEx[model.name][field.name] },
              ...QueryOptions
            },
            resolve(object, args, context) {
              args.where = args.where || {};
              args.where[related.name] = object[related.referencedField.name];
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
          where: { type: this.filterInputTypeMap[model.name] },
          ...QueryOptions
        },
        resolve(_, args, context) {
          return context.accessor.query(model, args);
        }
      };

      const name = model.name.charAt(0).toLowerCase() + model.name.slice(1);
      queryFields[name] = {
        type: this.modelTypeMap[model.name],
        args: { where: { type: this.inputTypesConnect[model.name] } },
        resolve(_, args, context: QueryContext) {
          return context.accessor.get(model, args.where);
        }
      };
    }

    return queryFields;
  }

  createMutationInputTypes() {
    const inputTypesCreate: InputTypeMap = {};
    const inputTypesUpdate: InputTypeMap = {};
    const inputTypesUpsert: InputTypeMap = {};

    const inputFieldsCreate: InputFieldsMap = {};
    const inputFieldsUpdate: InputFieldsMap = {};

    for (const model of this.domain.models) {
      inputTypesCreate[model.name] = new GraphQLInputObjectType({
        name: getCreateInputTypeName(model),
        fields() {
          return inputFieldsCreate[model.name];
        }
      });

      inputTypesUpdate[model.name] = new GraphQLInputObjectType({
        name: getUpdateInputTypeName(model),
        fields() {
          return inputFieldsUpdate[model.name];
        }
      });
    }

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
      inputTypesUpsert[model.name] = inputType;
    }

    const inputTypesCreateParent: InputTypeMap = {};
    const inputTypesUpdateParent: InputTypeMap = {};

    const inputTypesConnect = this.inputTypesConnect;

    for (const model of this.domain.models) {
      const inputType = new GraphQLInputObjectType({
        name: getCreateInputParentTypeName(model),
        fields() {
          return {
            connect: { type: inputTypesConnect[model.name] },
            create: { type: inputTypesCreate[model.name] },
            upsert: { type: inputTypesUpsert[model.name] }
          };
        }
      });
      inputTypesCreateParent[model.name] = inputType;
    }

    for (const model of this.domain.models) {
      const inputType = new GraphQLInputObjectType({
        name: getUpdateInputParentTypeName(model),
        fields() {
          return {
            connect: { type: inputTypesConnect[model.name] },
            create: { type: inputTypesCreate[model.name] },
            update: { type: inputTypesUpdate[model.name] },
            upsert: { type: inputTypesUpsert[model.name] }
          };
        }
      });
      inputTypesUpdateParent[model.name] = inputType;
    }

    const inputFieldsConnectMap = this.inputFieldsConnectMap;

    for (const model of this.domain.models) {
      inputFieldsCreate[model.name] = {};
      inputFieldsUpdate[model.name] = {};
      for (const field of model.fields) {
        if (field instanceof ForeignKeyField) {
          inputFieldsCreate[model.name][field.name] = {
            type: inputTypesCreateParent[field.referencedField.model.name]
          };
          inputFieldsUpdate[model.name][field.name] = {
            type: inputTypesUpdateParent[field.referencedField.model.name]
          };
        } else if (field instanceof SimpleField) {
          inputFieldsCreate[model.name][field.name] = {
            type: getInputType(field)
          };
          inputFieldsUpdate[model.name][field.name] = {
            type: getType(field.column.type)
          };
        } else if (field instanceof RelatedField) {
          let connectType = this.inputTypesConnect[
            field.referencingField.model.name
          ];

          if (field.referencingField.uniqueKey) {
            connectType = new GraphQLInputObjectType({
              name: getConnectChildInputTypeName(field),
              fields() {
                return getFieldsExclude(inputFieldsConnectMap, field);
              }
            });
          }

          const createType = new GraphQLInputObjectType({
            name: getCreateChildInputTypeName(field),
            fields() {
              return getFieldsExclude(inputFieldsCreate, field);
            }
          });

          const updateType = new GraphQLInputObjectType({
            name: getUpdateChildInputTypeName(field),
            fields() {
              return getFieldsExclude(inputFieldsUpdate, field);
            }
          });

          const upsertType = new GraphQLInputObjectType({
            name: getUpsertChildInputTypeName(field),
            fields() {
              return {
                create: { type: createType },
                update: { type: updateType }
              };
            }
          });

          inputFieldsUpdate[model.name][field.name] = {
            type: new GraphQLInputObjectType({
              name: getUpdateChildInputTypeName(field) + 'X',
              fields() {
                return {
                  connect: { type: new GraphQLList(connectType) },
                  create: { type: new GraphQLList(createType) },
                  upsert: { type: new GraphQLList(upsertType) }
                };
              }
            })
          };

          inputFieldsCreate[model.name][field.name] = {
            type: new GraphQLInputObjectType({
              name: getCreateChildInputTypeName(field) + 'X',
              fields() {
                return {
                  connect: { type: new GraphQLList(connectType) },
                  create: { type: new GraphQLList(createType) },
                  update: { type: new GraphQLList(updateType) },
                  upsert: { type: new GraphQLList(upsertType) },
                  delete: { type: new GraphQLList(connectType) },
                  disconnect: { type: new GraphQLList(connectType) }
                };
              }
            })
          };
        }
      }
    }

    return { inputTypesCreate, inputTypesUpdate, inputTypesUpsert };
  }

  createMutationFields(): GraphQLFieldConfigMap<any, QueryContext> {
    const {
      inputTypesCreate,
      inputTypesUpdate,
      inputTypesUpsert
    } = this.createMutationInputTypes();

    const mutationFields: GraphQLFieldConfigMap<any, QueryContext> = {};

    for (const model of this.domain.models) {
      const name = 'create' + model.name;
      mutationFields[name] = {
        type: this.modelTypeMap[model.name],
        args: { data: { type: inputTypesCreate[model.name] } },
        resolve(_, args, context) {
          return context.accessor.create(model, args.data);
        }
      };
    }

    for (const model of this.domain.models) {
      const name = 'update' + model.name;
      mutationFields[name] = {
        type: this.modelTypeMap[model.name],
        args: inputTypesUpdate[model.name].getFields(),
        resolve(_, args, context) {
          return context.accessor.update(model, args.data, args.where);
        }
      };
    }

    for (const model of this.domain.models) {
      const name = 'upsert' + model.name;
      mutationFields[name] = {
        type: this.modelTypeMap[model.name],
        args: inputTypesUpsert[model.name].getFields(),
        resolve(_, args, context) {
          return context.accessor.upsert(model, args.create, args.update);
        }
      };
    }

    for (const model of this.domain.models) {
      const name = 'delete' + model.name;
      mutationFields[name] = {
        type: this.modelTypeMap[model.name],
        args: {
          where: { type: this.inputTypesConnect[model.name] }
        },
        resolve(_, args, context) {
          return context.accessor.delete(model, args.where);
        }
      };
    }

    return mutationFields;
  }

  getSchema(): GraphQLSchema {
    return this.schema;
  }
}

function _typeName(
  usage: string,
  model: Model,
  field: Field,
  kind: string
): string {
  let typeName = model.name;
  if (field) {
    typeName += toPascalCase(field.name);
  }
  return `${usage}${typeName}${kind}Type`;
}

// Example: FilterUserDataType, FilterUserOrdersDataType
function getFilterInputTypeName(model: Model, field?: Field) {
  return _typeName('Filter', model, field, 'Input');
}

function getFindInputTypeName(model: Model, field?: Field) {
  return _typeName('Find', model, field, 'Input');
}

// Example: User, UserOrders
function getModelDataTypeName(model: Model, field?: Field) {
  return _typeName('', model, field, '');
}

function getCreateInputTypeName(model: Model, field?: Field) {
  return _typeName('Create', model, field, 'Data');
}

function getUpdateInputTypeName(model: Model, field?: Field) {
  return _typeName('Update', model, field, 'Data');
}

function getCreateInputParentTypeName(model: Model) {
  return _typeName('Set', model, undefined, 'Parent');
}

function getUpdateInputParentTypeName(model: Model) {
  return _typeName('Update', model, undefined, 'Parent');
}

function getUpdateOneInputTypeName(model: Model, field?: Field) {
  return _typeName2(model, field, 'UpdateOneInputType');
}

function getUpsertInputTypeName(model: Model, field?: Field) {
  return _typeName2(model, field, 'UpsertInputType');
}

function getCreateInputChildTypeName(model: Model, field?: Field) {
  return _typeName2(model, field, 'InputTypeChild');
}

function _typeName2(model: Model, field: Field, kind: string): string {
  let typeName = model.name;
  if (field) {
    typeName += toPascalCase(field.name);
  }
  return `${typeName}${kind}`;
}

function getConnectChildInputTypeName(field: RelatedField): string {
  return `Connect${field.getPascalName()}Input`;
}

function getCreateChildInputTypeName(field: RelatedField): string {
  return `Create${field.getPascalName()}Input`;
}

function getUpdateChildInputTypeName(field: RelatedField): string {
  return `Update${field.getPascalName()}Input`;
}

function getUpsertChildInputTypeName(field: RelatedField): string {
  return `Upsert${field.getPascalName()}Input`;
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

function _exclude(data, except: string | Field) {
  const result = {};
  if (except instanceof Field) {
    except = except.name;
  }
  for (const key in data) {
    if (key !== except) {
      result[key] = data[key];
    }
  }
  return result;
}

function getFieldsExclude(
  fieldsMap: InputFieldsMap,
  related: RelatedField
): GraphQLInputFieldConfigMap {
  return _exclude(
    fieldsMap[related.referencingField.model.name],
    related.referencingField.name
  );
}
