import knex = require('knex');
// console.log(knex.raw('?? > ?', ['where', 'danger\'']).toString())
import {
  Model,
  Field,
  SimpleField,
  ForeignKeyField,
  RelatedField
} from './domain';

import { Value, QueryArgs } from './common';

interface BuilderContext {
  counter: number;
  map: {
    [key: number]: {
      [key: string]: number;
    };
  };
}

export class QueryBuilder {
  db: knex;
  model: Model;
  context: BuilderContext;
  id: number;
  queryType: string;

  constructor(
    db: knex | QueryBuilder,
    model: Model,
    queryType: string = 'SELECT'
  ) {
    if (db instanceof QueryBuilder) {
      this.db = db.db;
      this.context = db.context;
    } else {
      this.db = db;
      this.context = { counter: 0, map: {} };
    }
    this.model = model;
    this.id = this.context.counter++;
    this.queryType = queryType.toUpperCase();
  }

  select(): knex.QueryBuilder {
    return this.db.select(this.prefix()).from(this.alias());
  }

  prefix(field?: Field) {
    const name: string = field ? (field as SimpleField).column.name : '*';
    return this.queryType === 'SELECT' ? `t${this.id}.${name}` : name;
  }

  alias(model?: Model) {
    return this.queryType === 'SELECT'
      ? `${(model || this.model).table.name} as t${this.id}`
      : (model || this.model).table.name;
  }

  buildWhere(args: QueryArgs, level: number = 0) {
    const me = this;
    return function() {
      for (const key in args) {
        let [name, op] = splitArg(key); // __
        const field = me.model.field(name);
        const value = args[key];
        switch (op) {
          case 'lt':
            this.where(me.prefix(field), '<', value);
            break;
          case 'le':
            this.where(me.prefix(field), '<=', value);
            break;
          case 'ge':
            this.where(me.prefix(field), '>=', value);
            break;
          case 'gt':
            this.where(me.prefix(field), '>', value);
            break;
          case 'ne':
            this.where(me.prefix(field), '!=', value);
            break;
          case 'like':
            this.where(me.prefix(field), 'like', value);
            break;
          case 'in':
            this.whereIn(me.prefix(field), value);
            break;
          case 'exists':
            if (value) this.whereNotNull(me.prefix(field));
            else this.whereNull(me.prefix(field));
            break;
          case 'some':
            this.whereExists(me.subquery(field, value as QueryArgs));
            break;
          case 'none':
            this.whereNotExists(me.subquery(field, value as QueryArgs));
            break;
          default:
            if (!op) {
              if (name === 'AND') {
                this.andWhere(me.combine(value as QueryArgs[], name, level));
              } else if (name === 'OR') {
                this.orWhere(me.combine(value as QueryArgs[], name, level));
              } else if (name === 'NOT') {
                this.whereNot(me.combine(value as QueryArgs[], name, level));
              } else {
                if (field instanceof ForeignKeyField) {
                  const model = field.referencedField.model;
                  const builder = new QueryBuilder(me, model);
                  builder.id = me.context.map[level][name];
                  this.where(builder.buildWhere(value as QueryArgs, level + 1));
                } else if (value && typeof value === 'object') {
                  const where = transformWhere(me.model, value as QueryArgs);
                  this.where(where);
                } else {
                  this.where(me.prefix(field), value);
                }
              }
            } else {
              throw `Unknown comparison operator: ${op}`;
            }
        }
      }
    };
  }

  combine(args: QueryArgs[], op: string, level: number) {
    const me = this;
    return function() {
      for (const arg of args) {
        if (op === 'AND') {
          this.where(me.buildWhere(arg, level));
        } else {
          this.orWhere(me.buildWhere(arg, level), args);
        }
      }
    };
  }

  join(query: knex.QueryBuilder, args: QueryArgs) {
    for (const name in args) {
      if (name.indexOf('_') === -1) {
        const field = this.model.field(name);
        if (field instanceof ForeignKeyField) {
          const model = field.referencedField.model;
          const builder = new QueryBuilder(this, model);
          const left = this.prefix(field);
          const right = builder.prefix(model.primaryKey.fields[0]);
          query.join(builder.alias(model), left, right);
          const level = this.id;
          this.context.map[level] = this.context.map[level] || {};
          this.context.map[level][name] = builder.id;
          builder.join(query, args[name] as QueryArgs);
        }
      }
    }
  }

  subquery(field: Field, args: QueryArgs) {
    const related = (field as RelatedField).referencingField;
    const builder = new QueryBuilder(this, related.model);
    const left = builder.prefix(related);
    const right = this.prefix(this.model.primaryKey.fields[0]);
    const query = builder.select();
    builder.join(query, args);
    query.where(builder.buildWhere(args, builder.id));
    query.whereRaw(`${left}=${right}`);
    return query;
  }

  reset(model: Model) {
    this.model = model;
    this.context.counter = 0;
    this.id = this.context.counter++;
  }
}

export function splitArg(arg: string): string[] {
  const match = /^(.+?)_([^_]+)$/.exec(arg);
  return match ? [match[1], match[2]] : [arg];
}

function transformWhere(model: Model, args: QueryArgs) {
  const result = {};
  for (const key in args) {
    let [name, op] = splitArg(key); // __
    if (/^(AND|OR|NOT)$/.test(name)) {
      result[key] = args[key];
    } else {
      const field = model.field(name);
      if (field instanceof SimpleField) {
        name = field.column.name;
      }
      if (op) {
        name = `${name}_${op}`;
      }
      result[name] = args[key];
    }
  }
  return result;
}

export function buildQuery(db: knex, table: Model, args: QueryArgs) {
  const builder = new QueryBuilder(db, table);
  const query = builder.select();

  if (args.where) {
    const where = args.where as QueryArgs;
    builder.join(query, where);
    builder.reset(table);
    query.where(builder.buildWhere(where));
  }

  if (args.limit !== undefined) {
    query.limit(args.limit as number);
  } else {
    query.limit(50); // DEFAULT_LIMIT
  }

  if (args.offset !== undefined) {
    query.offset(args.offset as number);
  }

  if (args.orderBy !== undefined) {
    query.orderBy(args.orderBy as string);
  }

  return query;
}
