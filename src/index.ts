import { Accessor } from './accessor';
import { Connection, createConnection } from './engine';
import { GraphQLSchema } from 'graphql';
import { Schema } from './model';
import { SchemaBuilder } from './schema';
import { Database, DatabaseOptions } from './database';

function createGraphQLSchema(schema: Schema): GraphQLSchema {
  return new SchemaBuilder(schema).getSchema();
}

function createGraphQLContext(
  db: Database | Schema,
  connection?: Connection,
  options?: DatabaseOptions
) {
  if (db instanceof Schema) {
    db = new Database(db, connection, options);
  }

  return {
    accessor: new Accessor(db)
  };
}

export {
  Schema,
  Database,
  createGraphQLSchema,
  createConnection,
  createGraphQLContext
};
