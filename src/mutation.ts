import { encodeFilter } from './filter';
import { Connection } from './engine';
import {
  Model,
  Field,
  SimpleField,
  ForeignKeyField,
  RelatedField
} from './model';

type Input = Document;

enum MutationType {
  Create,
  Update,
  Delete
}

interface ConnectCreateUpsertInput {
  connect: Document;
  create: Input;
  upsert: UpsertInput;
}

interface UpsertInput {
  create: Input;
  update?: Input;
}

export function createOne(
  db: Connection,
  model: Model,
  data: Input
): Promise<Row> {
  return resolveParentFields(db, model, data).then(row =>
    db.insert(model, row).then(id => {
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
  db: Connection,
  field: ForeignKeyField,
  where: Document
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
  db: Connection,
  model: Model,
  input: Input
): Promise<Row> {
  const result: Row = {};
  const promises = [];

  function _createPromise(field: ForeignKeyField, input: Input): void {
    const method = Object.keys(input)[0];
    let promise =
      method === 'connect'
        ? connect(db, field, input[method] as Document)
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
  db: Connection,
  model: Model,
  where: Document,
  columns: string
): Promise<Row[]> {
  return new Promise(resolve => {
    db.select(model, columns, { where }).then(rows => {
      rows = rowsToCamel(rows, model);
      resolve(rows);
    });
  });
}

export function upsertOne(
  db: Connection,
  model: Model,
  input: Input
): Promise<Row> {
  if (!model.checkUniqueKey(input.create)) {
    return Promise.reject('Bad filter');
  }

  return resolveParentFields(db, model, input.create as Document).then(row => {
    const uniqueFields = model.getUniqueFields(row);
    return select(db, model, uniqueFields, '*').then(rows => {
      if (rows.length === 0) {
        return createOne(db, model, input.create as Document);
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
  db: Connection,
  model: Model,
  args: Document
): Promise<Row> {
  if (!model.checkUniqueKey(args.where)) {
    return Promise.reject('Bad filter');
  }

  return new Promise((resolve, reject) => {
    const data = args.data as Document;
    resolveParentFields(db, model, data).then(row => {
      db.update(model, row, args.where as Document).then(() => {
        const where = Object.assign({}, args.where);
        for (const key in where) {
          if (key in row) {
            where[key] = row[key];
          }
        }
        select(db, model, where as Document, '*').then(rows => {
          const id = rows[0][model.keyField().name] as Value;
          updateChildFields(db, model, data, id).then(() => resolve(rows[0]));
        });
      });
    });
  });
}

function updateChildFields(
  db: Connection,
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
        updateChildField(db, field.referencingField, id, input[key] as Document)
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
  db: Connection,
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
        where: { ...(arg.where as Document), [field.name]: id }
      }));
      promises.push(updateMany(db, model, rows));
    } else if (method === 'delete') {
      // FIXME
      const wheres = args.map(arg => ({
        ...(arg.where as Document),
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
  db: Connection,
  model: Model,
  data: Input,
  where: Document | Document[]
) {
  return db.update(model, data as Row, where);
}

function createMany(
  db: Connection,
  model: Model,
  rows: Input[]
): Promise<Row[]> {
  const promises = rows.map(data => createOne(db, model, data));
  return Promise.all(promises);
}

function upsertMany(
  db: Connection,
  model: Model,
  rows: Input[]
): Promise<Row[]> {
  const promises = rows.map(data => upsertOne(db, model, data));
  return Promise.all(promises);
}

function updateMany(
  db: Connection,
  model: Model,
  rows: Input[]
): Promise<Row[]> {
  const promises = rows.map(data => updateOne(db, model, data));
  return Promise.all(promises);
}

function deleteMany(
  db: Connection,
  model: Model,
  args: Document[]
): Promise<Row[]> {
  return new Promise((resolve, reject) => {
    db
      .select(model, '*', { where: args })
      .then(rows => db.delete(model, args).then(() => resolve(rows)));
  });
}

export function deleteOne(
  db: Connection,
  model: Model,
  args: Document
): Promise<Row> {
  if (model.checkUniqueKey(args.where)) {
    return select(db, model, args.where as Document, '*').then(rows => {
      if (rows.length === 0) {
        return null;
      } else {
        return db.delete(model, args.where as Document).then(() => rows[0]);
      }
    });
  }
  return Promise.reject(Error('Bad filter'));
}
