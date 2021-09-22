import {
  Connection,
  ConnectionInfo,
  ConnectionPool,
  createConnectionPool,
  Database,
  getInformationSchema,
} from 'sqlex';
import { Database as SchemaInfo } from 'sqlex/dist/types';
import { Accessor, AccessorOptions, encodeFilter } from './accessor';
import { GraphQLSchemaBuilder, SchemaBuilderOptions } from './schema';
import { Schema as SchemaConfig } from 'sqlex/dist/config';
import { Schema } from 'sqlex/dist/schema';

export interface ArchenConfig {
  database: {
    connection: ConnectionInfo;
    schemaInfo?: SchemaInfo;
  };
  schema?: SchemaConfig;
  accessor?: AccessorOptions;
  graphql?: SchemaBuilderOptions;
}

type ConnectionMap = { [key: string]: ConnectionPool };

const EMPTY_DATABASE = { dialect: '', connection: null };

export class Archen {
  config: ArchenConfig;
  schema: Schema;
  graphql: GraphQLSchemaBuilder;

  private connectionMap: ConnectionMap = {};

  constructor(config: ArchenConfig) {
    this.config = { ...config };

    this.config.database = { ...(this.config.database || EMPTY_DATABASE) };

    if (this.config.database.connection)
      this.getConnectionPool(config.database.connection);

    if (this.config.database.schemaInfo) this.buildGraphQLSchema();
  }

  async getSchemaInfo(connectionInfo?: ConnectionInfo): Promise<SchemaInfo> {
    const connection = await this.getConnection(connectionInfo);
    const name = this.getDatabaseName(connectionInfo);
    const schemaInfo = await getInformationSchema(connection, name);
    if (connectionInfo)
      for (const key in connectionInfo)
        this.config.database[key] = connectionInfo[key];

    this.config.database.schemaInfo = schemaInfo;
    this.buildGraphQLSchema();
    connection.release();
    return schemaInfo;
  }

  getAccessor(connectionInfo?: ConnectionInfo): Accessor {
    const database = new Database(
      this.getConnectionPool(connectionInfo),
      this.schema
    );
    return new Accessor(database, this.config.accessor);
  }

  private getConnection(connectionInfo?: ConnectionInfo): Promise<Connection> {
    return this.getConnectionPool(connectionInfo).getConnection();
  }

  private getConnectionPool(connectionInfo?: ConnectionInfo): ConnectionPool {
    if (!(connectionInfo || this.config.database))
      throw Error('No connection info');

    const key = encodeConnectionInfo(connectionInfo);
    let pool = this.connectionMap[key];
    if (!pool) {
      connectionInfo = connectionInfo || this.config.database.connection;
      pool = createConnectionPool(
        connectionInfo.dialect,
        connectionInfo.connection
      );
      this.connectionMap[key] = pool;
    }
    return pool;
  }

  private buildGraphQLSchema() {
    this.schema = new Schema(
      this.config.database.schemaInfo,
      this.config.schema
    );
    this.graphql = new GraphQLSchemaBuilder(this.schema, this.config.graphql);
  }

  private getDatabaseName(connectionInfo?: ConnectionInfo): string {
    connectionInfo = connectionInfo || this.config.database.connection;
    const connection = connectionInfo.connection;
    return (connection.name || connection.database) as string;
  }
}

function encodeConnectionInfo(connectionInfo: ConnectionInfo): string {
  if (!connectionInfo) throw Error('Empty');
  return JSON.stringify(encodeFilter(connectionInfo.connection));
}

export { Accessor };
