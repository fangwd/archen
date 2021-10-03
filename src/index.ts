import { ConnectionInfo, ConnectionPool, Database } from 'sqlex';
import { Database as SchemaInfo } from 'sqlex/dist/types';
import { Accessor, AccessorOptions } from './accessor';
import { GraphQLSchemaBuilder, SchemaBuilderOptions } from './schema';
import { Schema as SchemaConfig } from 'sqlex/dist/config';
import { Schema } from 'sqlex/dist/schema';
import { Maybe } from 'graphql/jsutils/Maybe';
import {
  graphql,
  GraphQLFieldResolver,
  GraphQLTypeResolver,
  printError,
} from 'graphql';

export interface ArchenConfig {
  database: {
    connection: ConnectionPool | ConnectionInfo;
    schemaInfo?: SchemaInfo;
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
      this.bootstrap(schemaInfo);
    }
  }

  async bootstrap(schemaInfo?: SchemaInfo) {
    if (!schemaInfo) {
      const database = new Database(this.config.database.connection);
      await database.buildSchema(this.config.schema);
      this.schema = database.schema;
      this.accessor = new Accessor(database, this.config.accessor);
    } else {
      this.schema = new Schema(schemaInfo, this.config.schema);
      this.accessor = new Accessor(
        new Database(this.config.database.connection, this.schema),
        this.config.accessor
      );
    }
    this.graphql = new GraphQLSchemaBuilder(this.schema, this.config.graphql);
  }

  async query<T>(args: QueryArgs, dataKey?: string) {
    const { data, errors } = await graphql({
      schema: this.graphql.getSchema(),
      rootValue: this.graphql.getRootValue(),
      contextValue: this.accessor,
      ...args,
    });
    if (errors) {
      const message = errors.map((error) => printError(error)).join('\n');
      throw new Error(message);
    }
    return (dataKey ? data[dataKey] : data) as T;
  }

  shutdown() {
    if (this.accessor) {
      return this.accessor.db.end();
    }
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
