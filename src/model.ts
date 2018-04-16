import { pluralise, toPascalCase, toCamelCase } from './misc';
import { Document } from './database';

interface DatabaseInfo {
  name?: string;
  tables: TableInfo[];
}

interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  indexes?: IndexInfo[];
}

interface ColumnInfo {
  name: string;
  type: string;
  size?: number;
  nullable?: boolean;
  autoIncrement?: boolean;
}

interface IndexInfo {
  table?: string;
  columns: string[];
  primaryKey?: boolean;
  unique?: boolean;
  references?: IndexInfo;
}

export interface SchemaConfig {
  models: ModelConfig[];
}

interface ModelConfig {
  name?: string;
  table?: string;
  fields?: FieldConfig[];
  pluralName?: string;
}

interface FieldConfig {
  name?: string;
  column?: string;
  relatedName?: string;
  throughField?: string;
}

const SCHEMA_CONFIG: SchemaConfig = { models: [] };
const MODEL_CONFIG: ModelConfig = { fields: [] };
const FIELD_CONFIG: FieldConfig = {};

export class Schema {
  database: DatabaseInfo;
  config: SchemaConfig;
  models: Model[] = [];

  private modelMap: { [key: string]: Model } = {};

  private getModelConfig(table: TableInfo) {
    return this.config.models.find(config => config.table === table.name);
  }

  private addModel(model: Model) {
    if (model.name in this.modelMap) {
      throw Error(`Duplicate model name: ${model.name}`);
    }

    if (model.table.name !== model.name) {
      if (model.table.name in this.modelMap) {
        throw Error(`Duplicate model name: ${model.table.name})`);
      }
    }

    this.models.push(model);

    this.modelMap[model.name] = model;
    if (model.name !== model.table.name) {
      this.modelMap[model.table.name] = model;
    }
  }

  constructor(database: DatabaseInfo, config = SCHEMA_CONFIG) {
    this.database = database;
    this.config = Object.assign({}, SCHEMA_CONFIG, config);

    for (const table of database.tables) {
      const model = new Model(this, table, this.getModelConfig(table));
      this.addModel(model);
    }

    for (const model of this.models) {
      model.resolveForeignKeyFields();
    }

    for (const model of this.models) {
      model.resolveRelatedFields();
    }
  }

  model(name: string): Model {
    return this.modelMap[name];
  }
}

export class Model {
  domain: Schema;
  name: string;
  fields: Field[] = [];
  table: TableInfo;
  config: ModelConfig;
  primaryKey: UniqueKey;
  uniqueKeys: UniqueKey[] = [];
  pluralName: string;

  private fieldMap: { [key: string]: Field } = {};

  private getFieldConfig(column: ColumnInfo) {
    return this.config.fields.find(field => field.column === column.name);
  }

  constructor(domain: Schema, table: TableInfo, config: ModelConfig) {
    this.domain = domain;
    this.table = table;
    this.config = Object.assign({}, MODEL_CONFIG, config);
    this.name = this.config.name || toPascalCase(table.name);
    this.pluralName =
      this.config.pluralName || toCamelCase(pluralise(table.name));

    const references: { [key: string]: IndexInfo } = {};
    for (const index of table.indexes) {
      if (index.references) {
        if (index.columns.length > 1) {
          throw Error('Composite foreign keys are not supported');
        }
        references[index.columns[0]] = index;
      }
    }

    for (const column of table.columns) {
      const config = this.getFieldConfig(column);
      const field = references[column.name]
        ? new ForeignKeyField(this, column, config)
        : new SimpleField(this, column, config);
      this.addField(field);
    }
  }

  field(name: string): Field {
    return this.fieldMap[name];
  }

  keyField(): SimpleField {
    return this.primaryKey.fields.length === 1
      ? this.primaryKey.fields[0]
      : null;
  }

  keyValue(row: Document): Document {
    return row[this.keyField().name] as Document;
  }

  checkUniqueKey(row, accept?): UniqueKey {
    if (!row) return null;

    if (!accept) {
      accept = value => value !== undefined;
    }

    let uniqueKey = this.primaryKey;
    for (const field of uniqueKey.fields) {
      if (!accept(row[field.name])) {
        uniqueKey = null;
        break;
      }
    }

    if (!uniqueKey) {
      for (const key of this.uniqueKeys) {
        if (!key.primary) {
          let missing;
          for (const field of key.fields) {
            if (!accept(row[field.name])) {
              missing = field;
              break;
            }
          }
          if (!missing) {
            uniqueKey = key;
            break;
          }
        }
      }
    }
    return uniqueKey;
  }

  getUniqueFields(row) {
    const uniqueKey = this.checkUniqueKey(row);
    if (uniqueKey) {
      const fields = {};
      for (const field of uniqueKey.fields) {
        fields[field.name] = row[field.name];
      }
      return fields;
    }
  }

  // Get the number of foreign key fields pointing to the given model
  getForeignKeyCount(model: Model): number {
    let count = 0;
    for (const field of this.fields) {
      if (field instanceof ForeignKeyField) {
        if (field.referencedField.model === model) {
          count++;
        }
      }
    }
    return count;
  }

  resolveForeignKeyFields() {
    for (const index of this.table.indexes) {
      if (index.primaryKey || index.unique) {
        const fields = index.columns.map(name => this.field(name));
        const uniqueKey = new UniqueKey(fields, index.primaryKey);
        for (const field of fields) {
          field.uniqueKey = uniqueKey;
        }
        this.uniqueKeys.push(uniqueKey);
        if (index.primaryKey) {
          this.primaryKey = uniqueKey;
        }
      }

      if (index.references) {
        const field = this.field(index.columns[0]);
        if (field instanceof ForeignKeyField) {
          const referencedTable = this.domain.model(index.references.table);
          const columnName = index.references.columns[0];
          const referencedField = referencedTable.field(columnName);
          if (referencedField instanceof SimpleField) {
            field.referencedField = referencedField;
          } else {
            throw Error(`Bad referenced field: ${columnName}`);
          }
        }
      }
    }
  }

  resolveRelatedFields() {
    const fieldCount = this.fields.length;
    for (let i = 0; i < fieldCount; i++) {
      const field = this.fields[i];
      if (field instanceof ForeignKeyField) {
        const relatedField = new RelatedField(field);
        relatedField.model.addField(relatedField);
        field.relatedField = relatedField;
      }
    }
  }

  private addField(field: Field) {
    if (field.name in this.fieldMap) {
      throw Error(`Duplicate field name: ${field.name}`);
    }

    let column: ColumnInfo;
    if (field instanceof SimpleField) {
      column = field.column;
      if (column.name in this.fieldMap) {
        throw Error(`Duplicate field name: ${column.name}`);
      }
    }

    this.fields.push(field);
    this.fieldMap[field.name] = field;

    if (column && column.name !== field.name) {
      this.fieldMap[column.name] = field;
    }
  }
}

export class Field {
  name: string;
  model: Model;
  config: FieldConfig;

  uniqueKey?: UniqueKey;

  constructor(name: string, model: Model, config: FieldConfig) {
    this.name = name;
    this.model = model;
    this.config = config;
  }

  isUnique(): boolean {
    return this.uniqueKey && this.uniqueKey.fields.length == 1;
  }

  displayName(): string {
    return `${this.model.name}::${this.name}`;
  }
}

export class SimpleField extends Field {
  column: ColumnInfo;

  constructor(model: Model, column: ColumnInfo, config) {
    config = Object.assign({}, FIELD_CONFIG, config);
    super(config.name || toCamelCase(column.name), model, config);
    this.column = column;
  }
}

export class ForeignKeyField extends SimpleField {
  referencedField: SimpleField;
  relatedField?: RelatedField;

  constructor(model: Model, column: ColumnInfo, config) {
    super(model, column, config);
    if (!this.config.name) {
      const match = /(.+?)(?:_id|Id)/.exec(column.name);
      if (match) {
        this.name = toCamelCase(match[1]);
      }
    }
  }
}

export class RelatedField extends Field {
  referencingField: ForeignKeyField;
  throughField?: ForeignKeyField;

  constructor(field: ForeignKeyField) {
    const model = field.referencedField.model;
    const config = field.config;
    super(config.relatedName, model, config);
    this.referencingField = field;

    if (config.throughField) {
      const throughField = field.model.field(config.throughField);
      if (throughField instanceof ForeignKeyField) {
        this.throughField = throughField;
      } else {
        throw Error(`Field ${config.throughField} is not a foreign key`);
      }
    }

    if (!this.name) {
      if (this.throughField) {
        this.name = this.throughField.referencedField.model.pluralName;
      } else if (field.isUnique()) {
        this.name = lcfirst(field.model.name);
      } else {
        if (field.model.getForeignKeyCount(this.model) === 1) {
          this.name = field.model.pluralName;
        } else {
          this.name = field.model.pluralName + toPascalCase(field.name);
        }
      }
    }
  }

  // Example: UserOrder, CategoryCategoryAncestor
  getPascalName(plural?: boolean) {
    if (this.throughField) {
      const model = this.throughField.referencedField.model;
      return `${this.model.name}${pluralise(model.name)}`;
    }
    const model = this.referencingField.model;
    if (model.getForeignKeyCount(this.model) === 1) {
      return `${this.model.name}${plural ? pluralise(model.name) : model.name}`;
    }
    const name = this.referencingField.name;
    const suffix = toPascalCase(plural ? pluralise(name) : name);
    return `${this.model.name}${model.name}${suffix}`;
  }
}

class UniqueKey {
  fields: SimpleField[];
  primary: boolean;

  constructor(fields: Field[], primary: boolean = false) {
    this.fields = fields as SimpleField[];
    this.primary = primary;
  }
}

function lcfirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
