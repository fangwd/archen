import { Accessor } from './accessor';
import { Connection, createConnection } from './engine';
import { GraphQLSchema } from 'graphql';
import { Schema, SchemaConfig } from './model';
import { SchemaBuilder } from './schema';

export class Instance {
  domain: Schema;
  schema: GraphQLSchema;

  constructor(data: string | Buffer | any, config?: SchemaConfig) {
    if (data instanceof Buffer) {
      data = data.toString();
    }

    if (typeof data === 'string') {
      data = JSON.parse(data);
    }

    this.domain = new Schema(data, config);
    this.schema = new SchemaBuilder(this.domain).getSchema();
  }

  getSchema() {
    return this.schema;
  }

  getContext(db: Connection) {
    return {
      accessor: new Accessor(this.domain, db)
    };
  }
}

export { createConnection };
