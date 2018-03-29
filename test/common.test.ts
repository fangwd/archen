import { splitArg } from '../src/common';
import helper = require('./helper');

test('split name and operator', () => {
  let [name, op] = splitArg('orders_some');
  expect(name).toBe('orders');
  expect(op).toBe('some');
  [name, op] = splitArg('orders');
  expect(name).toBe('orders');
  expect(op).toBe(undefined);
});
