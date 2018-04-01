import { Filter, Value } from './database';
import { Model, SimpleField, ForeignKeyField, RelatedField } from './model';
import { Escape } from './engine';

class Context {
  private counter: number;

  constructor() {
    this.counter = 1;
  }

  getNumber(): number {
    return this.counter++;
  }
}

class Builder {
  model: Model;
  dialect: Escape;
  context?: Context;
  alias?: string;

  constructor(model: Model, dialect: Escape, context?: Context) {
    this.model = model;
    this.dialect = dialect;
    if ((this.context = context)) {
      this.alias = 't' + context.getNumber();
    } else {
      this.alias = '';
    }
  }

  where(args: Filter): string {
    if (Array.isArray(args)) {
      return args.length ? this.or(args) : '';
    } else {
      return Object.keys(args).length ? this.and(args as Filter) : '';
    }
  }

  private or(args: Filter[]): string {
    const exprs = args.map(arg => this.and(arg));
    return `(${exprs.join(' or ')})`;
  }

  private and(args: Filter): string {
    const exprs: string[] = [];
    for (const key in args) {
      const [name, operator] = splitKey(key);
      const field = this.model.field(name);
      const value = args[key];
      if (field instanceof ForeignKeyField) {
        const query = value as Filter;
        if (query === null || typeof query !== 'object') {
          exprs.push(this.expr(field, '=', value));
          continue;
        } else {
          const keys = Object.keys(query);
          if (keys.length === 1) {
            const [name, operator] = splitKey(keys[0] as string);
            if (name === field.referencedField.name) {
              exprs.push(this.expr(field, operator, query[keys[0]] as Value));
              continue;
            }
          }
        }
        exprs.push(this._in(field, query));
      } else if (field instanceof SimpleField) {
        exprs.push(this.expr(field, operator, value as Value));
      } else if (field instanceof RelatedField) {
        exprs.push(this.exists(field, operator, value as Filter));
      } else {
        throw Error(`Bad field: ${name}`);
      }
    }
    return `(${exprs.join(' and ')})`;
  }

  private expr(field: SimpleField, operator: string, value: Value | Value[]) {
    const lhs = this._prefix(field.column.name);

    if (Array.isArray(value)) {
      if (!operator || operator === 'in') {
        const values = value
          .filter(value => value !== null)
          .map(value => this.escape(field, value));
        if (values.length < value.length) {
          return `(${lhs} is null or ${lhs} in (${values.join(', ')}))`;
        } else {
          return `${lhs} in (${values.join(', ')})`;
        }
      } else {
        throw Error(`Bad value: ${JSON.stringify(value)}`);
      }
    }

    operator = operator || '=';

    if (operator === '=' && value === null) {
      return `${lhs} is null`;
    }

    if (operator === 'null') {
      return value ? `${lhs} is null` : `${lhs} is not null`;
    }

    return `${lhs} ${operator} ${this.escape(field, value)}`;
  }

  private getContext(): Context {
    if (!this.context) {
      this.context = new Context();
    }
    return this.context;
  }

  private select(name: string | number, args: Filter = {}): string {
    const where = this.where(args);
    return (
      `${this._select(name)} ${this._from()}` +
      (where.trim().length > 0 ? ` where ${where}` : '')
    );
  }

  column(): string {
    return this._prefix(this.model.keyField().column.name);
  }
  private _select(name: string | number): string {
    return `select ${this._prefix(name)}`;
  }

  private _prefix(name: string | number): string {
    if (typeof name === 'number') {
      return name + '';
    }
    name = this.escapeId(name);
    return `${this.alias || this.escapeId(this.model.table.name)}.${name}`;
  }

  private _from(): string {
    const from = `from ${this.escapeId(this.model.table.name)}`;
    return this.alias ? `${from} ${this.alias}` : from;
  }

  private _in(field: ForeignKeyField, args: Filter) {
    const model = field.referencedField.model;
    const builder = new Builder(model, this.dialect, this.getContext());
    const lhs = this._prefix(field.column.name);
    const rhs = builder.select(model.keyField().column.name, args);
    return `${lhs} in (${rhs})`;
  }

  private exists(field: RelatedField, operator: string, args: Filter) {
    const model = field.referencingField.model;
    const builder = new Builder(model, this.dialect, this.getContext());
    const scope =
      builder.select(1) +
      ' where ' +
      builder._prefix(field.referencingField.column.name) +
      '=' +
      this._prefix(this.model.keyField().name);

    const exists = operator === 'none' ? 'not exists' : 'exists';

    const where = field.throughField
      ? builder._in(field.throughField, args)
      : builder.where(args);

    return where.length > 0
      ? `${exists} (${scope} and ${where})`
      : `${exists} (${scope})`;
  }

  private escape(field: SimpleField, value: Value): string {
    if (/^bool/i.test(field.column.type)) {
      return value ? 'true' : 'false';
    }
    if (/int|float|double|number/i.test(field.column.type)) {
      if (typeof value === 'number') {
        return value + '';
      }
    }
    if (value instanceof Builder) {
      return value.column();
    }
    return this.dialect.escape(value + '');
  }

  private escapeId(name: string): string {
    return this.dialect.escapeId(name);
  }
}

export function encodeFilter(
  args: Filter,
  model: Model,
  escape?: Escape
): string {
  escape = escape || {
    escapeId: s => '`' + s + '`',
    escape: s => "'" + (s + '').replace(/'/g, "\\'") + "'"
  };
  const builder = new Builder(model, escape);
  return builder.where(args);
}

const OPERATOR_MAP = {
  lt: '<',
  le: '<=',
  ge: '>=',
  gt: '>',
  ne: '<>',
  in: 'in',
  like: 'like',
  null: 'null'
};

export function splitKey(arg: string): string[] {
  const match = /^(.+?)_([^_]+)$/.exec(arg);
  if (match) {
    const op = match[2] in OPERATOR_MAP ? OPERATOR_MAP[match[2]] : match[2];
    return [match[1], op];
  }
  return [arg];
}
