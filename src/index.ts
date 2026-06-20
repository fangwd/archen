import { ConnectionInfo, ConnectionPool, Database } from 'sqlex';
import { Database as SchemaInfo } from 'sqlex/dist/types';
import { Accessor, AccessorOptions } from './accessor';
import { GraphQLSchemaBuilder, SchemaBuilderOptions } from './schema';
import { Schema as SchemaConfig } from 'sqlex/dist/config';
import { Schema } from 'sqlex/dist/schema';
import { Maybe } from 'graphql/jsutils/Maybe';
import {
  graphql,
  print,
  printSchema as printGraphQLSchema,
  DocumentNode,
  GraphQLError,
  GraphQLFieldResolver,
  GraphQLTypeResolver,
  Kind,
} from 'graphql';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { JsonFilterOptions, OperatorMap } from 'sqlex/dist/filter';

// Operators inside a json/jsonb filter are expressed as key suffixes (e.g.
// `age__gt`). A single-underscore delimiter silently collides with snake_case
// document keys that end in an operator word (`opt_in` -> path `opt` + `in`),
// so default to `__`. `both` also accepts the explicit `$gt` form, which is
// only reachable when the filter is passed as a GraphQL variable.
const DEFAULT_JSON_FILTER_OPTIONS: JsonFilterOptions = {
  operatorSyntax: 'both',
  operatorDelimiter: '__'
};

export interface ArchenConfig {
  database: {
    connection: ConnectionPool | ConnectionInfo;
    schemaInfo?: SchemaInfo;
    jsonFilterOptions?: JsonFilterOptions;
  };
  schema?: SchemaConfig;
  accessor?: AccessorOptions;
  graphql?: SchemaBuilderOptions;
}

export class Archen {
  config: ArchenConfig;
  accessor!: Accessor;
  schema!: Schema;
  graphql!: GraphQLSchemaBuilder;

  constructor(config: ArchenConfig) {
    this.config = config;
    const schemaInfo = config.database.schemaInfo;
    if (schemaInfo) {
      this.bootstrap(schemaInfo, config.graphql?.operators);
    }
  }

  async bootstrap(schemaInfo?: SchemaInfo, operators?: OperatorMap) {
    const jsonFilterOptions =
      this.config.database.jsonFilterOptions ?? DEFAULT_JSON_FILTER_OPTIONS;
    if (!schemaInfo) {
      const database = new Database(
        this.config.database.connection,
        undefined,
        operators,
        jsonFilterOptions
      );
      await database.buildSchema(this.config.schema);
      this.schema = database.schema;
      this.accessor = new Accessor(database, this.config.accessor);
    } else {
      this.schema = new Schema(schemaInfo, this.config.schema);
      this.accessor = new Accessor(
        new Database(
          this.config.database.connection,
          this.schema,
          operators,
          jsonFilterOptions
        ),
        this.config.accessor
      );
    }
    this.graphql = new GraphQLSchemaBuilder(this.schema, this.config.graphql);
  }

  // Run a typed operation produced by GraphQL codegen (a TypedDocumentNode):
  // the result and variables types are inferred. See docs/codegen.md.
  query<TData, TVariables>(
    document: TypedDocumentNode<TData, TVariables>,
    variableValues?: TVariables
  ): Promise<TData>;
  // Run an operation from a source string; T (and the optional dataKey unwrap)
  // are supplied by the caller.
  query<T = any>(args: QueryArgs, dataKey?: string): Promise<T>;
  async query(
    request: QueryArgs | TypedDocumentNode<any, any>,
    second?: any
  ): Promise<any> {
    let args: QueryArgs;
    let dataKey: string | undefined;
    if ((request as DocumentNode).kind === Kind.DOCUMENT) {
      args = { source: print(request as DocumentNode), variableValues: second };
    } else {
      args = request as QueryArgs;
      dataKey = second;
    }
    const { data, errors } = await graphql({
      schema: this.graphql.getSchema(),
      rootValue: this.graphql.getRootValue(),
      contextValue: this.accessor,
      ...args,
    });
    if (errors) {
      const message = errors.map((error) => error.toString()).join('\n');
      throw new GraphQLQueryError(message, errors, data);
    }
    return dataKey ? data?.[dataKey] : data;
  }

  // The generated GraphQL schema as SDL, for feeding GraphQL codegen tools.
  printSchema(): string {
    return printGraphQLSchema(this.graphql.getSchema());
  }

  shutdown() {
    if (this.accessor) {
      return this.accessor.db.end();
    }
  }
}

// Thrown by Archen.query when the GraphQL execution returns errors. The
// concatenated message is preserved for backward compatibility, while the
// structured `errors` (with path/locations/extensions) and any partial
// `data` remain available for callers that want to inspect them.
export class GraphQLQueryError extends Error {
  errors: readonly GraphQLError[];
  data: unknown;
  constructor(message: string, errors: readonly GraphQLError[], data: unknown) {
    super(message);
    this.name = 'GraphQLQueryError';
    this.errors = errors;
    this.data = data;
  }
}

export interface QueryArgs {
  source: string;
  variableValues?: Maybe<{ [key: string]: any }>;
  operationName?: Maybe<string>;
  fieldResolver?: Maybe<GraphQLFieldResolver<any, any>>;
  typeResolver?: Maybe<GraphQLTypeResolver<any, any>>;
}

export { Accessor };
