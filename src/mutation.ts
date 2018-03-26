import knex = require('knex');
import { QueryBuilder } from './query-builder';
import {
  Row,
  QueryArgs,
  rowsToCamel,
  rowToSnake,
  Value,
  serialise,
  rowsToSnake
} from './common';

import {
  Model,
  Field,
  SimpleField,
  ForeignKeyField,
  RelatedField
} from './domain';

type Input = QueryArgs;

enum MutationType {
  Create,
  Update,
  Delete
}

interface ConnectCreateUpsertInput {
  connect: QueryArgs;
  create: Input;
  upsert: UpsertInput;
}

interface UpsertInput {
  create: Input;
  update?: Input;
}

export function createOne(db: knex, model: Model, data: Input): Promise<Row> {
  return resolveParentFields(db, model, data).then(row =>
    db(model.table.name)
      .insert(rowToSnake(row, model))
      .then(id => {
        if (Array.isArray(id)) id = id[0];
        return updateChildFields(db, model, data, id).then(() =>
          select(db, model, { [model.keyField().name]: id }, '*').then(rows =>
            Promise.resolve(rows.length === 1 ? rows[0] : null)
          )
        );
      })
  );
}

function connect(
  db: knex,
  field: ForeignKeyField,
  where: QueryArgs
): Promise<Row> {
  const model = field.referencedField.model;
  const name = model.keyField().name;

  const keys = Object.keys(where);
  if (keys.length === 1 && keys[0] === name) {
    return Promise.resolve(where as Row);
  }

  if (!model.checkUniqueKey(where)) {
    const msg = `Bad selector: ${JSON.stringify(where)}`;
    return Promise.reject(Error(msg));
  }

  return select(db, model, where, name).then(
    rows => (rows.length === 1 ? rows[0] : null)
  );
}

function resolveParentFields(
  db: knex,
  model: Model,
  input: Input
): Promise<Row> {
  const result: Row = {};
  const promises = [];

  function _createPromise(field: ForeignKeyField, input: Input): void {
    const method = Object.keys(input)[0];
    let promise =
      method === 'connect'
        ? connect(db, field, input[method] as QueryArgs)
        : createOne(db, field.referencedField.model, input[method] as Input);
    promise = promise.then(row => {
      result[field.name] = row
        ? row[field.referencedField.model.keyField().name]
        : null;
      return row;
    });
    promises.push(promise);
  }

  for (const key in input) {
    let field = model.field(key);
    if (
      field instanceof ForeignKeyField &&
      input[key] &&
      typeof input[key] === 'object'
    ) {
      _createPromise(field, input[key] as Input);
    } else if (field instanceof SimpleField) {
      result[key] = input[key] as Value;
    }
  }

  return Promise.all(promises).then(() => result);
}

function select(
  db: knex,
  model: Model,
  where: QueryArgs,
  columns: string
): Promise<Row[]> {
  return new Promise(resolve => {
    db
      .select(columns)
      .from(model.table.name)
      .where(function() {
        if (Array.isArray(where)) {
          for (const w of where) {
            const k = Object.keys(w);
            if (k.length === 1 && w[k[0]] && typeof w[k[0]] === 'object') {
              this.orWhere(w[k[0]]);
            } else {
              this.orWhere(w);
            }
          }
        } else {
          this.where(where);
        }
      })
      .then(rows => {
        rows = rowsToCamel(rows, model);
        resolve(rows);
      });
  });
}

export function upsertOne(db: knex, model: Model, input: Input): Promise<Row> {
  if (!model.checkUniqueKey(input.create)) {
    return Promise.reject('Bad filter');
  }

  return resolveParentFields(db, model, input.create as QueryArgs).then(row => {
    const uniqueFields = model.getUniqueFields(row);
    return select(db, model, uniqueFields, '*').then(rows => {
      if (rows.length === 0) {
        return createOne(db, model, input.create as QueryArgs);
      } else {
        if (input.update && Object.keys(input.update).length > 0) {
          return updateOne(db, model, {
            data: input.update,
            where: uniqueFields
          });
        } else {
          return rows[0];
        }
      }
    });
  });
}

export function updateOne(
  db: knex,
  model: Model,
  args: QueryArgs
): Promise<Row> {
  if (!model.checkUniqueKey(args.where)) {
    return Promise.reject('Bad filter');
  }
  const builder = new QueryBuilder(db, model, 'UPDATE');
  const where = builder.buildWhere(args.where as QueryArgs);
  return new Promise((resolve, reject) => {
    const data = args.data as QueryArgs;
    resolveParentFields(db, model, data).then(row => {
      db(model.table.name)
        .update(rowToSnake(row, model))
        .where(where)
        .then(() => {
          const where = Object.assign({}, args.where);
          for (const key in where) {
            if (key in row) {
              where[key] = row[key];
            }
          }
          select(db, model, where as QueryArgs, '*').then(rows => {
            const id = rows[0][model.keyField().name];
            updateChildFields(db, model, data, id).then(() => resolve(rows[0]));
          });
        });
    });
  });
}

function updateChildFields(
  db: knex,
  model: Model,
  input: Input,
  id: Value
): Promise<void> {
  const promises = [];
  for (const key in input) {
    let field = model.field(key);
    if (field instanceof RelatedField) {
      const related = field.referencingField;
      promises.push(
        updateChildField(db, field.referencingField, id, input[
          key
        ] as QueryArgs)
      );
    }
  }
  return Promise.all(promises).then(() => Promise.resolve());
}

function assignArgs(args: Input, field: SimpleField, value: Value): Input {
  return field instanceof ForeignKeyField
    ? {
        [field.name]: { [field.referencedField.model.keyField.name]: value },
        ...args
      }
    : { [field.name]: value, ...args };
}

function updateChildField(
  db: knex,
  field: SimpleField,
  id: Value,
  input: Input
): Promise<void> {
  const promises = [];
  const model = field.model;

  for (const method in input) {
    const args = input[method] as Input[];
    if (method === 'connect') {
      promises.push(update(db, model, { [field.name]: id }, args));
    } else if (method === 'create') {
      const rows = args.map(arg => ({ [field.name]: id, ...arg }));
      promises.push(createMany(db, model, rows));
    } else if (method === 'upsert') {
      const rows = args.map(arg => ({
        create: { [field.name]: id, ...(arg.create as Input) },
        update: { [field.name]: id, ...(arg.update as Input) }
      }));
      promises.push(upsertMany(db, model, rows));
    } else if (method === 'update') {
      const rows = args.map(arg => ({
        data: arg.data,
        where: { ...(arg.where as QueryArgs), [field.name]: id }
      }));
      promises.push(updateMany(db, model, rows));
    } else if (method === 'delete') {
      // FIXME
      const wheres = args.map(arg => ({
        ...(arg.where as QueryArgs),
        [field.name]: id
      }));
    } else if (method === 'disconnect') {
      const where = args.map(arg => ({ [field.name]: id, ...arg }));
      promises.push(update(db, model, { [field.name]: null }, where));
    } else {
      throw Error(`Unknown method: ${method}`);
    }
  }

  return Promise.all(promises).then(() => Promise.resolve());
}

function update(
  db: knex,
  model: Model,
  data: Input,
  where: QueryArgs | QueryArgs[]
) {
  return db(model.table.name)
    .update(rowToSnake(data as Row, model))
    .where('id', '>', '1000');
  /*
  if (Array.isArray(where)) {
    for (const arg of where) {
      const builder = new QueryBuilder(db, model, 'UPDATE');
      query.orWhere(builder.buildWhere(arg));
    }
  } else {
    query.where(where);
  }
  */
}

function createMany(db: knex, model: Model, rows: Input[]): Promise<Row[]> {
  const promises = rows.map(data => createOne(db, model, data));
  return Promise.all(promises);
}

function upsertMany(db: knex, model: Model, rows: Input[]): Promise<Row[]> {
  const promises = rows.map(data => upsertOne(db, model, data));
  return Promise.all(promises);
}

function updateMany(db: knex, model: Model, rows: Input[]): Promise<Row[]> {
  const promises = rows.map(data => updateOne(db, model, data));
  return Promise.all(promises);
}

function deleteMany(db: knex, model: Model, args: QueryArgs[]): Promise<Row[]> {
  const builder = new QueryBuilder(db, model, 'DELETE');
  const where = builder.combine(args, 'OR', 0);
  return new Promise((resolve, reject) => {
    builder
      .select()
      .where(where)
      .then(rows =>
        db(model.table.name)
          .where(where)
          .del()
          .then(() => resolve(rows))
          .catch(reject)
      );
  });
}

export function deleteOne(
  db: knex,
  model: Model,
  args: QueryArgs
): Promise<Row> {
  if (model.checkUniqueKey(args.where)) {
    return select(db, model, args.where as QueryArgs, '*').then(rows => {
      if (rows.length === 0) {
        return null;
      } else {
        const builder = new QueryBuilder(db, model, 'DELETE');
        return db
          .del()
          .from(model.table.name)
          .where(builder.buildWhere(args.where as QueryArgs))
          .then(() => rows[0]);
      }
    });
  }
  return Promise.reject(Error('Bad filter'));
}
