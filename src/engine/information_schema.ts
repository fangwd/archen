import { Connection } from './connection';
import { DatabaseInfo, TableInfo, ColumnInfo, ConstraintInfo } from '../model';

export function getInformationSchema(
  connection: Connection,
  schemaName: string
): Promise<DatabaseInfo> {
  return new Builder(connection, schemaName).getResult();
}

class Builder {
  constructor(public connection: Connection, public schemaName: string) {}

  getResult(): Promise<DatabaseInfo> {
    return this.getTables().then(tables => {
      const result = {
        name: this.schemaName,
        tables
      };

      const promises = [];
      for (const table of tables) {
        promises.push(this.getColumns(table));
        promises.push(this.getConstraints(table));
      }

      return Promise.all(promises).then(() => result);
    });
  }

  getTables(): Promise<any> {
    return this.connection
      .query(
        `SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '${
          this.schemaName
        }'`
      )
      .then(rows => {
        const tables: TableInfo[] = [];
        for (const row of rows) {
          tables.push({
            name: row.TABLE_NAME,
            columns: [],
            constraints: []
          });
        }
        return tables;
      });
  }

  getColumns(table: TableInfo) {
    return this.connection
      .query(
        `SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = '${
          this.schemaName
        }' AND TABLE_NAME = '${table.name}'`
      )
      .then(rows => {
        for (const row of rows) {
          const column: ColumnInfo = {
            name: row.COLUMN_NAME,
            type: row.DATA_TYPE,
            nullable: row.IS_NULLABLE === 'YES'
          };
          if (/char|text/i.exec(column.type)) {
            column.size = row.CHARACTER_MAXIMUM_LENGTH;
          }
          if (/auto_increment/i.exec(row.EXTRA)) {
            column.autoIncrement = true;
          }
          table.columns.push(column);
        }
      });
  }

  getConstraints(table: TableInfo) {
    return this.connection
      .query(
        `SELECT * FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = '${
          this.schemaName
        }' AND TABLE_NAME = '${table.name}'`
      )
      .then(rows => {
        const promises = [];
        for (const row of rows) {
          const constraint: ConstraintInfo = {
            name: row.CONSTRAINT_NAME,
            columns: []
          };
          switch (row.CONSTRAINT_TYPE) {
            case 'PRIMARY KEY':
              constraint.primaryKey = true;
              promises.push(this.getConstraintsColumns(table.name, constraint));
              break;
            case 'UNIQUE':
              constraint.unique = true;
              promises.push(this.getConstraintsColumns(table.name, constraint));
              break;
            case 'FOREIGN KEY':
              promises.push(this.getConstraintsColumns(table.name, constraint));
              break;
          }
          table.constraints.push(constraint);
        }
        return Promise.all(promises).then(() => {
          const promises = [];
          for (const row of rows) {
            if (row.CONSTRAINT_TYPE === 'FOREIGN KEY') {
              const index = table.constraints.find(
                index => index.name === row.CONSTRAINT_NAME
              );
              promises.push(this.getReferentialConstraints(table, index));
            }
          }
          return Promise.all(promises);
        });
      });
  }

  getConstraintsColumns(tableName: string, index: ConstraintInfo) {
    const query = `SELECT * FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA='${
      this.schemaName
    }' AND TABLE_NAME='${tableName}' AND  CONSTRAINT_NAME='${
      index.name
    }' ORDER BY ORDINAL_POSITION`;
    return this.connection.query(query).then(rows => {
      for (const row of rows) {
        index.columns.push(row.COLUMN_NAME);
      }
    });
  }

  getReferentialConstraints(table: TableInfo, index: ConstraintInfo) {
    const query = `SELECT * FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = '${
      this.schemaName
    }' AND TABLE_NAME='${table.name}' AND CONSTRAINT_NAME='${index.name}'`;
    return this.connection.query(query).then(rows => {
      if (rows.length !== 1) throw Error('Unexpected result!');
      const row = rows[0];
      index.references = {
        name: row.UNIQUE_CONSTRAINT_NAME,
        table: row.REFERENCED_TABLE_NAME,
        columns: []
      };
      return this.getConstraintsColumns(
        index.references.table,
        index.references
      );
    });
  }
}
