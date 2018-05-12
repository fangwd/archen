import { Accessor, AccessorOptions } from './accessor';
import { Connection, createConnection } from './engine';
import { Schema, SchemaInfo, SchemaConfig } from './model';
import { SchemaBuilder, SchemaBuilderOptions } from './schema';
import { Database } from './database';
import { getInformationSchema } from './engine';

export interface ArchenConfig {
  database: {
    dialect: string;
    connection: any;
    schemaInfo: SchemaInfo;
  };
  schema?: SchemaConfig;
  accessor: AccessorOptions;
  graphql: SchemaBuilderOptions;
}

export class Archen {
  config: ArchenConfig;
  schema: Schema;
  graphql: SchemaBuilder;

  constructor(config: ArchenConfig) {
    this.config = config;
    if (config.database.schemaInfo) {
      this.schema = new Schema(config.database.schemaInfo, config.schema);
      this.graphql = new SchemaBuilder(this.schema, this.config.graphql);
    }
  }

  getSchemaInfo(): Promise<SchemaInfo> {
    const connection = this.createConnection();
    const name = this.getDatabaseName();
    return getInformationSchema(connection, name).then(schemaInfo => {
      this.config.database.schemaInfo = schemaInfo;
      this.schema = new Schema(schemaInfo, this.config.schema);
      this.graphql = new SchemaBuilder(this.schema, this.config.graphql);
      return connection.disconnect().then(() => schemaInfo);
    });
  }

  getAccessor(): Accessor {
    const database = new Database(this.schema, this.createConnection());
    return new Accessor(database, this.config.accessor);
  }

  createConnection(): Connection {
    return createConnection(
      this.config.database.dialect,
      this.config.database.connection
    );
  }

  getDatabaseName(): string {
    const connection = this.config.database.connection;
    return connection.name || connection.database;
  }
}
