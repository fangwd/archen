import { Accessor } from './accessor';
import { Connection, createConnection } from './engine';
import { GraphQLSchema } from 'graphql';
import { Schema } from './model';
import { SchemaBuilder } from './schema';
import { Database } from './database';

function createGraphQLSchema(schema: Schema): GraphQLSchema {
  return new SchemaBuilder(schema).getSchema();
}

export { Schema, Database, Accessor, createGraphQLSchema, createConnection };
