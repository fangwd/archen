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
  SelectionSetNode,
  GraphQLResolveInfo,
  Kind,
  ValueNode
} from 'graphql';

import { AND, GE, GT, IN, LE, LIKE, ILIKE, LT, NE, NONE, NOT, NULL, OR, SOME } from 'sqlex';
import { Field, ForeignKeyField, Model, RelatedField, Schema, SimpleField } from 'sqlex/dist/schema';
import { toPascalCase, pluralise } from 'sqlex/dist/utils';

import { Accessor } from './accessor';
import { firstOf } from './misc';
import {
  ModelConfig,
  isModelSelectable,
  isModelCreatable,
  isModelUpdatable,
  isModelUpsertable,
  isModelDeletable
} from './config';

interface ObjectTypeMap {
  [key: string]: GraphQLObjectType;
}

interface ObjectFieldsMap {
  [key: string]: GraphQLFieldConfigMap<any, Accessor>;
}

interface InputTypeMap {
  [key: string]: GraphQLInputObjectType;
}

interface InputFieldsMap {
  [key: string]: GraphQLInputFieldConfigMap;
}

const ConnectionOptions = {
  first: { type: GraphQLInt },
  after: { type: GraphQLString },
  last: { type: GraphQLInt },
  before: { type: GraphQLString },
  orderBy: { type: new GraphQLList(GraphQLString) }
};

const QueryOptions = {
  limit: { type: GraphQLInt },
  offset: { type: GraphQLInt },
  orderBy: { type: new GraphQLList(GraphQLString) }
};

function parseJSONLiteral(ast: ValueNode, variables?: any): any {
  switch (ast.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN:
    case Kind.ENUM:
      return ast.value;
    case Kind.INT:
    case Kind.FLOAT:
      return Number(ast.value);
    case Kind.OBJECT: {
      const value: { [key: string]: any } = {};
      for (const field of ast.fields) {
        value[field.name.value] = parseJSONLiteral(field.value, variables);
      }
      return value;
    }
    case Kind.LIST:
      return ast.values.map(node => parseJSONLiteral(node, variables));
    case Kind.NULL:
      return null;
    case Kind.VARIABLE:
      return variables ? variables[ast.name.value] : undefined;
    default:
      return undefined;
  }
}

const GraphQLJSON = new GraphQLScalarType({
  name: 'JSON',
  description: 'Arbitrary JSON value; used to filter into json/jsonb columns',
  serialize: value => value,
  parseValue: value => value,
  parseLiteral: parseJSONLiteral
});

const PageInfoType = new GraphQLObjectType({
  name: 'PageInfo',
  fields: () => ({
    startCursor: { type: GraphQLString },
    endCursor: { type: GraphQLString },
    hasNextPage: { type: GraphQLBoolean },
    hasPreviousPage: { type: GraphQLBoolean }
  })
});

export interface SchemaBuilderOptions {
  useWhereForGetOne?: boolean;
  getAccessor: (context: any) => Accessor;
  operators?: {
    [key: string]: string;
  };
  // When false, models are not exported to the API unless explicitly enabled
  // in `models`. Defaults to true.
  allowAll?: boolean;
  // Per-model export/accessibility config. `false` hides a model's root
  // query/mutation fields; an object enables fine-grained control such as
  // `{ create: false }`.
  models?: { [name: string]: boolean | ModelConfig };
}

const DEFAULT_OPTIONS = {
  useWhereForGetOne: false,
  getAccessor: (context: any) => context,
  operators: {},
  allowAll: true,
  models: {} as { [name: string]: boolean | ModelConfig }
};

export class GraphQLSchemaBuilder {
  private domain: Schema;
  private schema: GraphQLSchema;
  private rootValue: { [key: string]: any } = {};
  private options: SchemaBuilderOptions;

  private modelTypeMap: ObjectTypeMap = {};
  private connectionTypeMap: ObjectTypeMap = {};

  private filterInputTypeMap: InputTypeMap = {};
  private filterInputTypeMapEx: { [key: string]: { [key: string]: GraphQLInputObjectType } } = {};

  private inputTypesConnect: InputTypeMap = {};
  private inputFieldsConnectMap: InputFieldsMap = {};

  constructor(domain: Schema, options?: Partial<SchemaBuilderOptions>) {
    this.domain = domain;
    this.options = Object.assign({}, DEFAULT_OPTIONS, options);

    this.createFilterInputTypes();
    this.createModelTypes();

    const queryFields = this.createQueryFields();
    const mutationFields = this.createMutationFields();

    const schemaConfig: {
      query: GraphQLObjectType;
      mutation?: GraphQLObjectType;
    } = {
      query: new GraphQLObjectType({
        name: 'Query',
        fields: queryFields
      })
    };

    // GraphQL forbids an empty Mutation type, so only attach one when at
    // least one model exposes a write operation (e.g. a read-only API).
    if (Object.keys(mutationFields).length) {
      schemaConfig.mutation = new GraphQLObjectType({
        name: 'Mutation',
        fields: mutationFields
      });
    }

    this.schema = new GraphQLSchema(schemaConfig);
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
            const type = getType(field);
            if (type === GraphQLJSON) {
              // JSON columns take a nested filter object; the operators
              // (_lt, _in, ...) are expressed within that object by sqlex.
              filterInputFields[field.name] = { type };
              continue;
            }
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
              for (const like of [LIKE, ILIKE]) {
                const name = field.name + '_' + like;
                filterInputFields[name] = { type };
              }
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
              type: field.throughField
                ? this.filterInputTypeMap[
                    field.throughField.referencedField.model.name
                  ]
                : this.filterInputTypeMapEx[model.name][field.name]
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
    const modelTypeMapEx: { [key: string]: { [key: string]: any } } = {};
    const filterInputTypeMapEx = this.filterInputTypeMapEx;

    const modelFieldsMap: ObjectFieldsMap = {};
    const modelFieldsMapEx: { [key: string]: { [key: string]: any } } = {};

    const connectionTypeMapEx: { [key: string]: { [key: string]: any } } = {};
    const edgeModelTypeMap: ObjectTypeMap = {};

    const self = this;

    for (const model of this.domain.models) {
      this.modelTypeMap[model.name] = new GraphQLObjectType({
        name: getTypeName(model),
        fields(): GraphQLFieldConfigMap<any, Accessor> {
          return modelFieldsMap[model.name];
        }
      });

      edgeModelTypeMap[model.name] = new GraphQLObjectType({
        name: `${getTypeName(model)}Edge`,
        fields(): GraphQLFieldConfigMap<any, Accessor> {
          return {
            node: { type: modelTypeMap[model.name] },
            cursor: { type: GraphQLString }
          };
        }
      });

      this.connectionTypeMap[model.name] = new GraphQLObjectType({
        name: `${getTypeName(model)}Connection`,
        fields(): GraphQLFieldConfigMap<any, Accessor> {
          return {
            totalCount: { type: GraphQLInt },
            pageInfo: { type: PageInfoType },
            edges: { type: new GraphQLList(edgeModelTypeMap[model.name]) },
            [model.pluralName]: {
              type: new GraphQLList(modelTypeMap[model.name])
            }
          };
        }
      });

      modelFieldsMap[model.name] = {};
    }

    for (const model of this.domain.models) {
      modelTypeMapEx[model.name] = {};
      modelFieldsMapEx[model.name] = {};
      connectionTypeMapEx[model.name] = {};
      for (const field of model.fields) {
        if (field instanceof RelatedField) {
          modelTypeMapEx[model.name][field.name] = new GraphQLObjectType({
            name: getTypeName(field),
            fields(): GraphQLFieldConfigMap<any, Accessor> {
              return modelFieldsMapEx[model.name][field.name];
            }
          });
          if (!field.referencingField.isUnique()) {
            const edgeType = new GraphQLObjectType({
              name: `${getTypeName(field, true)}Edge`,
              fields(): GraphQLFieldConfigMap<any, Accessor> {
                return {
                  node: {
                    type: modelTypeMapEx[model.name][field.name]
                  },
                  cursor: { type: GraphQLString }
                };
              }
            });
            connectionTypeMapEx[model.name][field.name] = new GraphQLObjectType(
              {
                name: `${getTypeName(field)}Connection`,
                fields(): GraphQLFieldConfigMap<any, Accessor> {
                  return {
                    pageInfo: { type: PageInfoType },
                    edges: { type: new GraphQLList(edgeType) },
                    [field.name]: {
                      type: new GraphQLList(modelTypeMap[model.name])
                    }
                  };
                }
              }
            );
          }
        }
      }
    }

    for (const model of this.domain.models) {
      const modelFields = modelFieldsMap[model.name];
      for (const field of model.fields) {
        if (field instanceof ForeignKeyField) {
          modelFields[field.name] = {
            type: modelTypeMap[field.referencedField.model.name],
            resolve(obj, args, acc, info) {
              if (obj[field.name] === null) return null;
              const keyField = field.referencedField.model.keyField()!;
              const fields = getQueryFields(
                info,
                info.fieldNodes[0].selectionSet
              );
              if (hasOnly(fields, keyField.name)) {
                return obj[field.name];
              }
              return self
                .getAccessor(acc)
                .load(
                  { field: field.referencedField },
                  obj[field.name][keyField.name]
                );
            }
          };
        } else if (field instanceof SimpleField) {
          modelFields[field.name] = {
            type: getType(field)
          };
        } else if (field instanceof RelatedField) {
          const relatedField = field as RelatedField;
          if (relatedField.throughField) {
            const referenced = relatedField.throughField.referencedField;
            modelFields[field.name] = {
              type: new GraphQLList(modelTypeMap[referenced.model.name]),
              args: {
                where: { type: this.filterInputTypeMap[referenced.model.name] },
                ...QueryOptions
              },
              resolve(obj, args, acc, info) {
                const fields = getQueryFields(
                  info,
                  info.fieldNodes[0].selectionSet
                );
                return self
                  .getAccessor(acc)
                  .load(
                    { field: relatedField, ...args },
                    obj[model.keyField()!.name],
                    fields
                  );
              }
            };
            modelFields[field.name + 'Connection'] = {
              type: this.connectionTypeMap[referenced.model.name],
              args: {
                where: { type: this.filterInputTypeMap[referenced.model.name] },
                ...ConnectionOptions
              },
              resolve(obj, args, acc, info) {
                args.where = args.where || {};
                const name = relatedField.throughField!.relatedField!.name;
                if (relatedField.throughField!.relatedField!.throughField) {
                  args.where[name] = {
                    [model.keyField()!.name]: obj[model.keyField()!.name]
                  };
                } else {
                  args.where[name] = {
                    [field.referencingField.name]: obj[model.keyField()!.name]
                  };
                }
                return self
                  .getAccessor(acc)
                  .cursorQuery(
                    referenced.model,
                    args,
                    field.name,
                    firstOf(getQueryFields(info))
                  );
              }
            };
          } else {
            const modelTypeEx = modelTypeMapEx[model.name][field.name];
            const related = relatedField.referencingField;
            const type = related.isUnique()
              ? modelTypeEx
              : new GraphQLList(modelTypeEx);
            modelFields[field.name] = {
              type,
              args: {
                where: { type: filterInputTypeMapEx[model.name][field.name] },
                ...(related.isUnique() ? {} : QueryOptions)
              },
              resolve(object, args, acc) {
                return self
                  .getAccessor(acc)
                  .load(
                    { field: related, ...args },
                    object[related.referencedField.name]
                  )!
                  .then(rows => {
                    if (related.isUnique()) {
                      return Array.isArray(rows) ? rows[0] : rows;
                    }
                    return rows;
                  });
              }
            };
            if (!related.isUnique()) {
              modelFields[field.name + 'Connection'] = {
                type: connectionTypeMapEx[model.name][field.name],
                args: {
                  where: { type: filterInputTypeMapEx[model.name][field.name] },
                  ...ConnectionOptions
                },
                resolve(object, args, acc, info) {
                  args.where = args.where || {};
                  args.where[related.name] =
                    object[related.referencedField.name];
                  return self
                    .getAccessor(acc)
                    .cursorQuery(
                      related.model,
                      args,
                      field.name,
                      firstOf(getQueryFields(info))
                    );
                }
              };
            }
          }
        }
      }
    }

    for (const model of this.domain.models) {
      for (const field of model.fields) {
        if (field instanceof RelatedField) {
          if (field.throughField) {
            modelFieldsMapEx[model.name][field.name] =
              modelFieldsMap[field.throughField.referencedField.model.name];
          } else {
            const exFields: GraphQLFieldConfigMap<any, Accessor> = {};
            const related = field.referencingField;
            for (const name in modelFieldsMap[related.model.name]) {
              if (name !== related.name) {
                exFields[name] = modelFieldsMap[related.model.name][name];
              }
            }
            // A one-to-one whose child holds only the back-reference projects
            // to an empty type; keep the back-reference so the GraphQL type
            // stays valid. (The input side is handled by getFieldsExclude.)
            if (!Object.keys(exFields).length) {
              exFields[related.name] =
                modelFieldsMap[related.model.name][related.name];
            }
            modelFieldsMapEx[model.name][field.name] = exFields;
          }
        }
      }
    }
  }

  getAccessor(context: any): Accessor {
    return this.options.getAccessor(context);
  }

  private get allowAll(): boolean {
    return this.options.allowAll !== false;
  }

  private modelConfig(model: Model) {
    return this.options.models ? this.options.models[model.name] : undefined;
  }

  createQueryFields() {
    const queryFields: GraphQLFieldConfigMap<any, Accessor> = {};

    for (const model of this.domain.models) {
      if (!isModelSelectable(this.modelConfig(model), this.allowAll)) continue;

      queryFields[model.pluralName] = {
        type: new GraphQLList(this.modelTypeMap[model.name]),
        args: {
          where: { type: this.filterInputTypeMap[model.name] },
          ...QueryOptions
        }
      };

      this.rootValue[model.pluralName] = (args: any, acc: any, info: any) => {
        return this.getAccessor(acc).query(model, args);
      };

      const fieldName = `${model.pluralName}Connection`;

      queryFields[fieldName] = {
        type: this.connectionTypeMap[model.name],
        args: {
          where: { type: this.filterInputTypeMap[model.name] },
          ...ConnectionOptions
        }
      };

      this.rootValue[`${model.pluralName}Connection`] = (args: any, acc: any, info: any) => {
        return this.getAccessor(acc).cursorQuery(
          model,
          args,
          model.pluralName,
          getQueryFields(info)[fieldName],
          true
        );
      };

      const name = model.name.charAt(0).toLowerCase() + model.name.slice(1);
      queryFields[name] = {
        type: this.modelTypeMap[model.name],
        args: this.options.useWhereForGetOne
          ? { where: { type: this.inputTypesConnect[model.name] } }
          : this.inputTypesConnect[model.name].getFields()
      };

      this.rootValue[name] = (args: any, acc: any) => {
        return this.getAccessor(acc).get(
          model,
          this.options.useWhereForGetOne ? args.where : args
        );
      };

      const aggName = `${model.pluralName}Aggregate`;
      queryFields[aggName] = {
        type: new GraphQLList(this.buildAggregateType(model)),
        args: {
          where: { type: this.filterInputTypeMap[model.name] },
          groupBy: { type: new GraphQLList(GraphQLString) }
        }
      };
      this.rootValue[aggName] = (args: any, acc: any, info: any) => {
        return this.getAccessor(acc).aggregate(
          model,
          args,
          firstOf(getQueryFields(info))
        );
      };
    }

    return queryFields;
  }

  // Builds `<Model>Aggregate { keys, count, sum, avg, min, max }`. sum/avg
  // expose numeric columns; min/max and keys (the grouped column values) also
  // expose strings. Sub-objects are omitted when a model has no fields of the
  // relevant kind.
  private buildAggregateType(model: Model): GraphQLObjectType {
    const simple = model.fields.filter(
      f => f instanceof SimpleField && !(f instanceof ForeignKeyField)
    ) as SimpleField[];
    const isNumeric = (f: SimpleField) =>
      getType(f) === GraphQLInt || getType(f) === GraphQLFloat;
    const numeric = simple.filter(isNumeric);
    const scalar = simple.filter(
      f => isNumeric(f) || getType(f) === GraphQLString
    );

    const numberType = numeric.length
      ? new GraphQLObjectType({
          name: `${model.name}NumberAggregate`,
          fields: () => {
            const fields: GraphQLFieldConfigMap<any, Accessor> = {};
            for (const f of numeric) fields[f.name] = { type: GraphQLFloat };
            return fields;
          }
        })
      : undefined;

    const scalarType = scalar.length
      ? new GraphQLObjectType({
          name: `${model.name}FieldAggregate`,
          fields: () => {
            const fields: GraphQLFieldConfigMap<any, Accessor> = {};
            for (const f of scalar) fields[f.name] = { type: getType(f) };
            return fields;
          }
        })
      : undefined;

    return new GraphQLObjectType({
      name: `${model.name}Aggregate`,
      fields: () => {
        const fields: GraphQLFieldConfigMap<any, Accessor> = {
          count: { type: GraphQLInt }
        };
        if (scalarType) {
          fields.keys = { type: scalarType };
        }
        if (numberType) {
          fields.sum = { type: numberType };
          fields.avg = { type: numberType };
        }
        if (scalarType) {
          fields.min = { type: scalarType };
          fields.max = { type: scalarType };
        }
        return fields;
      }
    });
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
            type: getType(field)
          };
        } else if (field instanceof RelatedField) {
          let connectType, filterType;

          if (field.throughField) {
            const model = field.throughField.referencedField.model;
            connectType = this.inputTypesConnect[model.name];
            filterType = this.filterInputTypeMap[model.name];
          } else {
            connectType = this.inputTypesConnect[
              field.referencingField.model.name
            ];

            filterType = this.filterInputTypeMapEx[model.name][field.name];
          }

          const createType = new GraphQLInputObjectType({
            name: getCreateChildTypeName(field),
            fields() {
              return field.throughField
                ? inputFieldsCreate[
                    field.throughField.referencedField.model.name
                  ]
                : getFieldsExclude(inputFieldsCreate, field);
            }
          });

          const updateFields = new GraphQLInputObjectType({
            name: getUpdateChildTypeName(field) + 'Fields',
            fields() {
              return field.throughField
                ? inputFieldsUpdate[
                    field.throughField.referencedField.model.name
                  ]
                : getFieldsExclude(inputFieldsUpdate, field);
            }
          });

          const updateType = new GraphQLInputObjectType({
            name: getUpdateChildTypeName(field),
            fields() {
              return {
                data: { type: updateFields },
                where: { type: filterType }
              };
            }
          });

          const updateTypeUnique = new GraphQLInputObjectType({
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
                update: { type: updateFields }
              };
            }
          });

          if (field.referencingField.isUnique()) {
            inputFieldsCreate[model.name][field.name] = {
              type: new GraphQLInputObjectType({
                name: getCreateChildTypeName(field, 'One'),
                fields() {
                  return {
                    connect: { type: connectType },
                    create: { type: createType }
                  };
                }
              })
            };

            inputFieldsUpdate[model.name][field.name] = {
              type: new GraphQLInputObjectType({
                name: getUpdateChildTypeName(field, 'One'),
                fields() {
                  return {
                    connect: { type: connectType },
                    create: { type: createType },
                    upsert: { type: upsertType },
                    update: { type: updateTypeUnique }
                  };
                }
              })
            };
          } else {
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

            inputFieldsUpdate[model.name][field.name] = {
              type: new GraphQLInputObjectType({
                name: getUpdateManyChildTypeName(field),
                fields() {
                  return {
                    connect: { type: new GraphQLList(connectType) },
                    create: { type: new GraphQLList(createType) },
                    set: { type: new GraphQLList(createType) },
                    upsert: { type: new GraphQLList(upsertType) },
                    update: { type: new GraphQLList(updateType) },
                    delete: { type: new GraphQLList(filterType) },
                    disconnect: { type: new GraphQLList(filterType) }
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

  createMutationFields(): GraphQLFieldConfigMap<any, Accessor> {
    const {
      inputTypesCreate,
      inputTypesUpdate,
      inputTypesUpsert
    } = this.createMutationInputTypes();

    const mutationFields: GraphQLFieldConfigMap<any, Accessor> = {};

    for (const model of this.domain.models) {
      if (!isModelCreatable(this.modelConfig(model), this.allowAll)) continue;
      const name = 'create' + model.name;
      mutationFields[name] = {
        type: this.modelTypeMap[model.name],
        args: { data: { type: inputTypesCreate[model.name] } }
      };
      this.rootValue[name] = (args: any, acc: any) => {
        return this.getAccessor(acc).create(model, args.data);
      };
    }

    const databaseQueryResultType = new GraphQLObjectType({
      name: 'DatabaseQueryResultType',
      fields(): GraphQLFieldConfigMap<any, Accessor> {
        return {
          affectedRows: { type: GraphQLInt },
          changedRows: { type: GraphQLInt }
        };
      }
    });

    for (const model of this.domain.models) {
      if (!isModelUpdatable(this.modelConfig(model), this.allowAll)) continue;
      const name = 'update' + model.name;
      mutationFields[name] = {
        type: this.modelTypeMap[model.name],
        args: {
          where: { type: this.inputTypesConnect[model.name] },
          data: { type: inputTypesUpdate[model.name] }
        }
      };
      this.rootValue[name] = (args: any, acc: any) => {
        return this.getAccessor(acc).update(model, args.data, args.where);
      };
    }

    for (const model of this.domain.models) {
      if (!isModelUpdatable(this.modelConfig(model), this.allowAll)) continue;
      const name = 'update' + toPascalCase(model.pluralName);
      mutationFields[name] = {
        type: databaseQueryResultType,
        args: {
          where: { type: this.filterInputTypeMap[model.name] },
          data: { type: inputTypesUpdate[model.name] }
        }
      };
      this.rootValue[name] = (args: any, acc: any) => {
        return this.getAccessor(acc).updateMany(model, args.data, args.where);
      };
    }

    for (const model of this.domain.models) {
      if (!isModelUpsertable(this.modelConfig(model), this.allowAll)) continue;
      const name = 'upsert' + model.name;
      mutationFields[name] = {
        type: this.modelTypeMap[model.name],
        args: inputTypesUpsert[model.name].getFields()
      };
      this.rootValue[name] = (args: any, acc: any) => {
        return this.getAccessor(acc).upsert(model, args.create, args.update);
      };
    }

    for (const model of this.domain.models) {
      if (!isModelDeletable(this.modelConfig(model), this.allowAll)) continue;
      const name = 'delete' + model.name;
      mutationFields[name] = {
        type: this.modelTypeMap[model.name],
        args: this.options.useWhereForGetOne
          ? {
              where: { type: this.inputTypesConnect[model.name] }
            }
          : this.inputTypesConnect[model.name].getFields()
      };
      this.rootValue[name] = (args: any, acc: any) => {
        return this.getAccessor(acc).delete(
          model,
          this.options.useWhereForGetOne ? args.where : args
        );
      };
    }

    for (const model of this.domain.models) {
      if (!isModelDeletable(this.modelConfig(model), this.allowAll)) continue;
      const name = 'delete' + toPascalCase(model.pluralName);
      mutationFields[name] = {
        type: databaseQueryResultType,
        args: this.filterInputTypeMap[model.name].getFields()
      };
      this.rootValue[name] = (args: any, acc: any) => {
        return this.getAccessor(acc).deleteMany(model, args);
      };
    }

    return mutationFields;
  }

  getSchema(): GraphQLSchema {
    return this.schema;
  }

  getRootValue() {
    return this.rootValue;
  }
}

function getTypeName(input: Model | RelatedField, plural?: boolean) {
  if (input instanceof RelatedField) {
    return getPascalName(input, plural);
  }
  return input.name;
}

function getFilterTypeName(input: Model | RelatedField) {
  if (input instanceof RelatedField) {
    return `Filter${getPascalName(input)}Input`;
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

function getCreateChildTypeName(field: RelatedField, one?: string): string {
  return `Create${one || ''}${getPascalName(field)}Input`;
}

function getUpdateChildTypeName(field: RelatedField, one?: string): string {
  return `Update${one || ''}${getPascalName(field)}Input`;
}

function getCreateManyChildTypeName(field: RelatedField): string {
  return `CreateMany${getPascalName(field, true)}Input`;
}

function getUpdateManyChildTypeName(field: RelatedField): string {
  return `UpdateMany${getPascalName(field, true)}Input`;
}

function getUpsertChildTypeName(field: RelatedField): string {
  return `Upsert${getPascalName(field)}Input`;
}

function getPascalName(field: RelatedField, plural?: boolean) {
  const model = field.referencingField.model;
  if (field.throughField) {
    if (model.getForeignKeyCount(field.model) === 1) {
      const model = field.throughField.referencedField.model;
      return `${field.model.name}${pluralise(model.name)}`;
    } else {
      return toPascalCase(field.throughField.relatedField!.name);
    }
  }
  if (model.getForeignKeyCount(field.model) === 1) {
    return `${field.model.name}${plural ? pluralise(model.name) : model.name}`;
  }
  const name = field.referencingField.name;
  const suffix = toPascalCase(plural ? pluralise(name) : name);
  return `${field.model.name}${model.name}${suffix}`;
}

function getType(field: SimpleField): GraphQLScalarType {
  const type = field.config.userType || field.column.type;
  if (/char|text/i.test(type)) {
    return GraphQLString;
  } else if (/^(big|long|tiny)?(int|long)/i.test(type)) {
    return GraphQLInt;
  } else if (/float|double/i.test(type)) {
    return GraphQLFloat;
  } else if (/^bool/i.test(type)) {
    return GraphQLBoolean;
  } else if (/json/i.test(type)) {
    return GraphQLJSON;
  }
  return GraphQLString;
}

function getInputType(field: SimpleField): GraphQLInputType {
  const type = getType(field);
  return field.column.nullable || field.column.autoIncrement
    ? type
    : new GraphQLNonNull(type);
}

function _exclude(data: any, except: string | Field): { [key: string]: any } {
  const result: { [key: string]: any } = {};
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

export function getQueryFields(
  info: GraphQLResolveInfo,
  selectionSet?: SelectionSetNode
) {
  function __getFields(selectionSet: SelectionSetNode, object: { [key: string]: any } = {}) {
    for (const selection of selectionSet.selections) {
      if (selection.kind === 'Field') {
        const name = selection.name.value;
        object[name] = object[name] || {};
        if (selection.selectionSet) {
          __getFields(selection.selectionSet, object[name]);
        }
      } else if (selection.kind === 'FragmentSpread') {
        const fragment = info.fragments[selection.name.value];
        __getFields(fragment.selectionSet, object);
      } else if (selection.kind === 'InlineFragment') {
        __getFields(selection.selectionSet, object);
      }
    }
    return object;
  }
  return __getFields(selectionSet || info.operation.selectionSet);
}

export function isEmpty(value: any) {
  if (Array.isArray(value)) {
    return value.length === 0;
  } else if (value !== null && typeof value === 'object') {
    return Object.keys(value).length === 0;
  }
  return value === undefined;
}

export function hasOnly(object: object, key: string): boolean {
  if (object && typeof object === 'object') {
    const keys = Object.keys(object);
    if (keys.length === 1) {
      return keys[0] === key;
    }
  }
  return false;
}
