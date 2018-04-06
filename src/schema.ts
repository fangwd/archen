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

interface InputFieldsMap {
  [key: string]: GraphQLInputFieldConfigMap;
}

interface QueryContext {
  accessor: Accessor;
}

const ConnectionOptions = {
  first: { type: GraphQLInt },
  after: { type: GraphQLString },
  orderBy: { type: GraphQLString },
};

const QueryOptions = {
  limit: { type: GraphQLInt },
  offset: { type: GraphQLInt },
  orderBy: { type: GraphQLString }
};

const PageInfoType = new GraphQLObjectType({
  name: "PageInfo",
  fields: () => ({
    startCursor: { type: GraphQLString },
    endCursor: { type: GraphQLString },
    hasNextPage: { type: GraphQLBoolean },
    hasPreviousPage: { type: GraphQLBoolean },
  }),
})

export class SchemaBuilder {
  private domain: Schema;
  private schema: GraphQLSchema;

  private modelTypeMap: ObjectTypeMap = {};
  private connectionModelTypeMap: ObjectTypeMap = {};

  private filterInputTypeMap: InputTypeMap = {};
  private filterInputTypeMapEx = {};

  private inputTypesConnect: InputTypeMap = {};
  private inputFieldsConnectMap: InputFieldsMap = {};

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
        name: getFilterTypeName(model),
        fields() {
          return filterInputFields;
        }
      });

      filterInputFields[AND] = { type: new GraphQLList(filterDataType) };
      filterInputFields[OR] = { type: new GraphQLList(filterDataType) };
      filterInputFields[NOT] = { type: new GraphQLList(filterDataType) };

      const findDataType = new GraphQLInputObjectType({
        name: getFindTypeName(model),
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
      for (const field of model.fields) {
        if (field instanceof RelatedField) {
          this.filterInputTypeMapEx[model.name][
            field.name
          ] = this.relatedFilterInputType(field, filterInputFieldsMap);

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
      name: getFilterTypeName(field),
      fields() {
        return fields;
      }
    });
    fields[AND] = { type: new GraphQLList(filterInputType) };
    fields[OR] = { type: new GraphQLList(filterInputType) };
    fields[NOT] = { type: new GraphQLList(filterInputType) };
    return filterInputType;
  }

  createModelTypes() {
    const modelTypeMap = this.modelTypeMap;
    const modelTypeMapEx = {};
    const filterInputTypeMapEx = this.filterInputTypeMapEx;

    const modelFieldsMap: ObjectFieldsMap = {};
    const modelFieldsMapEx = {};

    const edgeModelTypeMap: ObjectTypeMap = {};

    for (const model of this.domain.models) {
      this.modelTypeMap[model.name] = new GraphQLObjectType({
        name: getTypeName(model),
        fields(): GraphQLFieldConfigMap<any, QueryContext> {
          return modelFieldsMap[model.name];
        }
      });

      edgeModelTypeMap[model.name] = new GraphQLObjectType({
        name: `${getTypeName(model)}Edge`,
        fields(): GraphQLFieldConfigMap<any, QueryContext> {
          return {
            node: { type: modelTypeMap[model.name] },
            cursor: { type: GraphQLString },
          }
        }
      });

      this.connectionModelTypeMap[model.name] = new GraphQLObjectType({
        name: `${getTypeName(model)}Connection`,
        fields(): GraphQLFieldConfigMap<any, QueryContext> {
          return {
            pageInfo: { type: PageInfoType },
            edges: { type: new GraphQLList(edgeModelTypeMap[model.name]) }
          }
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
            name: getTypeName(field),
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
          const type = related.isUnique() ? modelDataTypeEx : new GraphQLList(modelDataTypeEx);
          modelDataFields[field.name] = {
            type: type,
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

      queryFields[`${model.pluralName}Connection`] = {
        type: this.connectionModelTypeMap[model.name],
        args: {
          where: { type: this.filterInputTypeMap[model.name] },
          ...ConnectionOptions,
        },
        resolve(_, args, context) {
          // TODO
        }
      }

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
        name: getCreateTypeName(model),
        fields() {
          return inputFieldsCreate[model.name];
        }
      });

      inputTypesUpdate[model.name] = new GraphQLInputObjectType({
        name: getUpdateTypeName(model),
        fields() {
          return inputFieldsUpdate[model.name];
        }
      });
    }

    for (const model of this.domain.models) {
      const inputType = new GraphQLInputObjectType({
        name: getUpsertTypeName(model),
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
        name: getCreateParentTypeName(model),
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
        name: getUpdateParentTypeName(model),
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
              name: getConnectChildTypeName(field),
              fields() {
                return getFieldsExclude(inputFieldsConnectMap, field);
              }
            });
          }

          const createType = new GraphQLInputObjectType({
            name: getCreateChildTypeName(field),
            fields() {
              return getFieldsExclude(inputFieldsCreate, field);
            }
          });

          const updateType = new GraphQLInputObjectType({
            name: getUpdateChildTypeName(field),
            fields() {
              return getFieldsExclude(inputFieldsUpdate, field);
            }
          });

          const upsertType = new GraphQLInputObjectType({
            name: getUpsertChildTypeName(field),
            fields() {
              return {
                create: { type: createType },
                update: { type: updateType }
              };
            }
          });
          if (field.referencingField.isUnique()) {
            inputFieldsUpdate[model.name][field.name] = {
              type: new GraphQLInputObjectType({
                name: getUpdateChildTypeName(field, 'One'),
                fields() {
                  return {
                    connect: { type: connectType },
                    create: { type: createType },
                    upsert: { type: upsertType },
                    update: { type: updateType },
                    delete: { type: connectType },
                    disconnect: { type: connectType }
                  };
                }
              })
            };

            inputFieldsCreate[model.name][field.name] = {
              type: new GraphQLInputObjectType({
                name: getCreateChildTypeName(field, 'One'),
                fields() {
                  return {
                    connect: { type: connectType },
                    create: { type: createType },
                    upsert: { type: upsertType }
                  };
                }
              })
            };
          } else {
            inputFieldsUpdate[model.name][field.name] = {
              type: new GraphQLInputObjectType({
                name: getUpdateManyChildTypeName(field),
                fields() {
                  return {
                    connect: { type: new GraphQLList(connectType) },
                    create: { type: new GraphQLList(createType) },
                    upsert: { type: new GraphQLList(upsertType) },
                    update: { type: new GraphQLList(updateType) },
                    delete: { type: new GraphQLList(connectType) },
                    disconnect: { type: new GraphQLList(connectType) }
                  };
                }
              })
            };

            inputFieldsCreate[model.name][field.name] = {
              type: new GraphQLInputObjectType({
                name: getCreateManyChildTypeName(field),
                fields() {
                  return {
                    connect: { type: new GraphQLList(connectType) },
                    create: { type: new GraphQLList(createType) },
                    upsert: { type: new GraphQLList(upsertType) }
                  };
                }
              })
            };
          }
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
        args: {
          where: { type: this.inputTypesConnect[model.name] },
          data: { type: inputTypesUpdate[model.name] }
        },
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

function getTypeName(input: Model | RelatedField) {
  if (input instanceof RelatedField) {
    return input.getPascalName();
  }
  return input.name;
}

function getFilterTypeName(input: Model | RelatedField) {
  if (input instanceof RelatedField) {
    return `Filter${input.getPascalName()}Input`;
  }
  return `Filter${input.name}Input`;
}

function getFindTypeName(model: Model) {
  return `Find${model.name}Input`;
}

function getCreateTypeName(model: Model) {
  return `Create${model.name}Input`;
}

function getUpdateTypeName(model: Model) {
  return `Update${model.name}Input`;
}

function getUpsertTypeName(model: Model) {
  return `Upsert${model.name}Input`;
}

function getCreateParentTypeName(model: Model) {
  return `Create${model.name}ParentInput`;
}

function getUpdateParentTypeName(model: Model) {
  return `Upsert${model.name}ParentInput`;
}

function getConnectChildTypeName(field: RelatedField): string {
  return `Connect${field.getPascalName()}Input`;
}

function getCreateChildTypeName(field: RelatedField, one?: string): string {
  return `Create${one || ''}${field.getPascalName()}Input`;
}

function getUpdateChildTypeName(field: RelatedField, one?: string): string {
  return `Update${one || ''}${field.getPascalName()}Input`;
}

function getCreateManyChildTypeName(field: RelatedField): string {
  return `CreateMany${field.getPascalName(true)}Input`;
}

function getUpdateManyChildTypeName(field: RelatedField): string {
  return `UpdateMany${field.getPascalName(true)}Input`;
}

function getUpsertChildTypeName(field: RelatedField): string {
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
  const fields = _exclude(
    fieldsMap[related.referencingField.model.name],
    related.referencingField.name
  );

  if (!Object.keys(fields).length && related.referencingField.isUnique()) {
    const field = related.referencingField;
    fields[field.name] = fieldsMap[field.model.name][field.name];
  }

  return fields;
}
