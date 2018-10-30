import { Accessor, AccessorOptions, encodeFilter } from './accessor';
import { GraphQLSchemaBuilder, SchemaBuilderOptions } from './schema';

import {
  Schema,
  SchemaInfo,
  SchemaConfig,
  getInformationSchema,
  Database,
  Connection,
  ConnectionPool,
  ConnectionInfo,
  createConnectionPool
} from 'sqlit';

export interface ArchenConfig {
  database: {
    dialect: string;
    connection: any;
    schemaInfo: SchemaInfo;
  };
  schema?: SchemaConfig;
  accessor?: AccessorOptions;
  graphql?: SchemaBuilderOptions;
}

type ConnectionMap = { [key: string]: ConnectionPool };

export class Archen {
  config: ArchenConfig;
  schema: Schema;
  graphql: GraphQLSchemaBuilder;

  private connectionMap: ConnectionMap = {};

  constructor(config: ArchenConfig) {
    this.config = config;

    if (config.database.connection) {
      this.getConnectionPool(config.database);
    }

    if (config.database.schemaInfo) {
      this.buildGraphQLSchema();
    }
  }

  getSchemaInfo(connectionInfo?: ConnectionInfo): Promise<SchemaInfo> {
    return this.getConnection(connectionInfo).then(connection => {
      const name = this.getDatabaseName(connectionInfo);
      return getInformationSchema(connection, name).then(schemaInfo => {
        if (connectionInfo) {
          for (const key in connectionInfo) {
            this.config.database[key] = connectionInfo[key];
          }
        }
        this.config.database.schemaInfo = schemaInfo;
        this.buildGraphQLSchema();
        connection.release();
        return schemaInfo;
      });
    });
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
    if (!(connectionInfo = connectionInfo || this.config.database)) {
      throw Error('No connection info');
    }
    let key = encodeConnectionInfo(connectionInfo);
    let pool = this.connectionMap[key];
    if (!pool) {
      connectionInfo = connectionInfo || this.config.database;
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
    connectionInfo = connectionInfo || this.config.database;
    const connection = connectionInfo.connection;
    return connection.name || connection.database;
  }
}

function encodeConnectionInfo(connectionInfo: ConnectionInfo): string {
  if (!connectionInfo) throw Error('Empty');
  return JSON.stringify(encodeFilter(connectionInfo.connection));
}
