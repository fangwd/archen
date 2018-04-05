import { createSchema } from '../src/schema';
import * as helper from './helper';
import * as graphql from 'graphql';
import * as fs from 'fs';

const data = helper.getExampleData();

test('create schema', () => {
  const schema = createSchema(data);
  fs.writeFileSync('schema.graphql', graphql.printSchema(schema));
  expect(schema).not.toBe(undefined);
});
