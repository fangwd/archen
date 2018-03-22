import { pluralise, toPascal, toCamel } from './forms';

interface Database {
  name?: string;
  tables: Table[];
}

interface Table {
  name: string;
  columns: Column[];
  indexes?: Index[];
}

interface Column {
  name: string;
  type: string;
  size?: number;
  nullable?: boolean;
  autoIncrement?: boolean;
}

interface Index {
  table?: string;
  columns: string[];
  primaryKey?: boolean;
  unique?: boolean;
  references?: Index;
}

export interface DomainConfig {
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

const SCHEMA_CONFIG: DomainConfig = { models: [] };
const MODEL_CONFIG: ModelConfig = { fields: [] };
const FIELD_CONFIG: FieldConfig = {};

export class Domain {
  database: Database;
  config: DomainConfig;
  models: Model[] = [];

  private modelMap: { [key: string]: Model } = {};

  private getModelConfig(table: Table) {
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

  constructor(database: Database, config = SCHEMA_CONFIG) {
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
  domain: Domain;
  name: string;
  fields: Field[] = [];
  table: Table;
  config: ModelConfig;
  uniqueKeys: UniqueKey[] = [];
  pluralName: string;

  private fieldMap: { [key: string]: Field } = {};

  private getFieldConfig(column: Column) {
    return this.config.fields.find(field => field.column === column.name);
  }

  constructor(domain: Domain, table: Table, config: ModelConfig) {
    this.domain = domain;
    this.table = table;
    this.config = Object.assign({}, MODEL_CONFIG, config);
    this.name = this.config.name || toPascal(table.name);
    this.pluralName = this.config.pluralName || toCamel(pluralise(table.name));

    const references: { [key: string]: Index } = {};
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

  resolveForeignKeyFields() {
    for (const index of this.table.indexes) {
      if (index.primaryKey || index.unique) {
        const fields = index.columns.map(name => this.field(name));
        const uniqueKey = new UniqueKey(fields, index.primaryKey);
        for (const field of fields) {
          field.uniqueKey = uniqueKey;
        }
        this.uniqueKeys.push(uniqueKey);
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
      }
    }
  }

  private addField(field: Field) {
    if (field.name in this.fieldMap) {
      throw Error(`Duplicate field name: ${field.name}`);
    }

    let column: Column;
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
  column: Column;

  constructor(model: Model, column: Column, config) {
    config = Object.assign({}, FIELD_CONFIG, config);
    super(config.name || toCamel(column.name), model, config);
    this.column = column;
  }
}

export class ForeignKeyField extends SimpleField {
  referencedField: SimpleField;

  constructor(model: Model, column: Column, config) {
    super(model, column, config);
    if (!this.config.name) {
      const match = /(.+?)(?:_id|Id)/.exec(column.name);
      if (match) {
        this.name = toCamel(match[1]);
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
        const name = field.model.name;
        this.name = name.charAt(0).toLowerCase() + name.slice(1);
      } else {
        this.name = field.model.pluralName;
      }
    }
  }
}

class UniqueKey {
  fields: Field[];
  primary: boolean;

  constructor(fields: Field[], primary: boolean = false) {
    this.fields = fields;
    this.primary = primary;
  }
}
