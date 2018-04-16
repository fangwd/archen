import { Record } from './database';

export enum FlushMethod {
  INSERT,
  UPDATE,
  DELETE
}

export class FlushState {
  method: FlushMethod = FlushMethod.INSERT;
  dirty: Set<string> = new Set();
}

export const RecordProxy = {
  set: function(record: Record, name: string, value: any) {
    if (!/^__/.test(name)) {
      const model = record.__table.model;
      const field = model.field(name);
      if (!field) {
        throw Error(`Invalid field: ${model.name}.${name}`);
      }
      // throw TypeError(), RangeError(), etc
      record.__data[name] = value;
      record.__state.dirty.add(name);
    } else {
      record[name] = value;
    }
    return true;
  },

  get: function(record: Record, name: string) {
    if (typeof name === 'string' && !/^__/.test(name)) {
      if (typeof record[name] !== 'function') {
        const model = record.__table.model;
        const field = model.field(name);
        return record.__data[name];
      }
    }
    return record[name];
  }
};
