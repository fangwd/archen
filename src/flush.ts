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
    const model = record.__table.model;
    const field = model.field(name);

    if (!field) {
      throw Error(`Invalid field: ${model.name}.${name}`);
    }

    // throw TypeError(), RangeError(), etc

    record[name] = value;
    record.__state.dirty.add(name);

    return true;
  }
};
