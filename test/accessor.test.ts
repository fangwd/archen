import { encodeFilter } from '../src/accessor';

test('encodeFilter', () => {
  let filter: any = { y: 'bar', z: 'baz', x: 'foo' };

  expect(encodeFilter(filter)).toEqual([
    1,
    [['x', 'foo'], ['y', 'bar'], ['z', 'baz']]
  ]);

  filter = [{ a: 1, b: 2 }, { d: 4, c: 3 }];

  expect(encodeFilter(filter)).toEqual([
    0,
    [[1, [['a', 1], ['b', 2]]], [1, [['c', 3], ['d', 4]]]]
  ]);
});
