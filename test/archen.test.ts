import * as helper from './helper';
import { Archen } from '../src/index';
import { parse } from 'graphql';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';

const NAME = 'archen';

beforeAll(() => helper.createDatabase(NAME));
afterAll(() => helper.dropDatabase(NAME));

const buildArchen = async () => {
  const connection = helper.createTestConnectionPool(NAME);
  const archen = new Archen({ database: { connection } });
  // Introspect for every dialect (sqlex 3.6 added SQLite introspection).
  await archen.bootstrap();
  return archen;
};

describe('query', () => {
  test('simple query', async () => {
    const archen = await buildArchen();
    const source = `
    query {
      users {
        id
        email
      }
    }
    `;
    type User = { id: number; email: string };
    const rows = await archen.query<User[]>({ source }, 'users');
    expect(rows.length).toBeGreaterThan(1);
    expect(typeof rows[0].email).toBe('string');
    archen.shutdown();
  });

  test('query with variables', async () => {
    const archen = await buildArchen();
    const source = `
    query UserQuery($id: Int!) {
      users(where: {id: $id}) {
        id
        email
      }
    }
    `;
    const variableValues = { id: 1 };
    type User = { id: number; email: string };
    const rows = await archen.query<User[]>(
      { source, variableValues },
      'users'
    );
    expect(rows.length).toBe(1);
    expect(typeof rows[0].email).toBe('string');
    archen.shutdown();
  });

  test('query with errors', async () => {
    const archen = await buildArchen();
    const source = `
    query {
      users {
        id
        email2
      }
    }
    `;
    await expect(archen.query({ source })).rejects.toThrow();
    try {
      await archen.query({ source });
    } catch (e: any) {
      expect(e.name).toBe('GraphQLQueryError');
      expect(Array.isArray(e.errors)).toBe(true);
      expect(e.errors.length).toBeGreaterThan(0);
    }
    archen.shutdown();
  });
});

describe('aggregate', () => {
  test('count/sum/avg/min/max over a filtered set', async () => {
    const archen = await buildArchen();
    const source = `
    query {
      productsAggregate(where: { status: 1 }) {
        count
        sum { price }
        avg { price }
        min { price name }
        max { price }
      }
    }
    `;
    const rows: any = await archen.query({ source }, 'productsAggregate');
    expect(rows.length).toBe(1);
    const agg = rows[0];
    // 7 of 8 products have status 1 (sku004 has status 0)
    expect(agg.count).toBe(7);
    // prices of status-1 products: 5,6,7,15,16,17,18 = 84
    expect(agg.sum.price).toBe(84);
    expect(agg.avg.price).toBeCloseTo(12);
    expect(agg.min.price).toBe(5);
    expect(agg.max.price).toBe(18);
    expect(typeof agg.min.name).toBe('string');
    archen.shutdown();
  });

  test('count only, no filter', async () => {
    const archen = await buildArchen();
    const source = `query { productsAggregate { count } }`;
    const rows: any = await archen.query({ source }, 'productsAggregate');
    expect(rows.length).toBe(1);
    expect(rows[0].count).toBe(8);
    archen.shutdown();
  });

  test('ignores __typename in aggregate sub-selections', async () => {
    // Clients (e.g. Apollo) auto-add __typename on object types; it must not
    // be treated as a column to aggregate.
    const archen = await buildArchen();
    const source = `
    query {
      productsAggregate {
        __typename
        count
        sum { price __typename }
      }
    }
    `;
    const rows: any = await archen.query({ source }, 'productsAggregate');
    expect(rows[0].count).toBe(8);
    expect(rows[0].sum.price).toBe(92);
    archen.shutdown();
  });

  test('groupBy returns one entry per group with keys', async () => {
    const archen = await buildArchen();
    const source = `
    query {
      productsAggregate(groupBy: ["status"]) {
        keys { status }
        count
        sum { price }
      }
    }
    `;
    const rows: any = await archen.query({ source }, 'productsAggregate');
    const byStatus: { [k: number]: any } = {};
    for (const r of rows) byStatus[r.keys.status] = r;
    // status 1 -> 7 products, status 0 -> 1 product (sku004, price 8)
    expect(rows.length).toBe(2);
    expect(byStatus[1].count).toBe(7);
    expect(byStatus[1].sum.price).toBe(84);
    expect(byStatus[0].count).toBe(1);
    expect(byStatus[0].sum.price).toBe(8);
    archen.shutdown();
  });
});

describe('codegen', () => {
  test('printSchema emits SDL for the generated schema', async () => {
    const archen = await buildArchen();
    const sdl = archen.printSchema();
    expect(sdl).toContain('type User');
    expect(sdl).toContain('scalar JSON');
    expect(sdl).toMatch(/usersAggregate\(.*\): \[UserAggregate\]/);
    archen.shutdown();
  });

  test('query accepts a typed document and infers the result type', async () => {
    const archen = await buildArchen();
    const doc = parse(
      'query ($id: Int!) { users(where: { id: $id }) { id email } }'
    ) as TypedDocumentNode<
      { users: { id: number; email: string }[] },
      { id: number }
    >;
    const data = await archen.query(doc, { id: 1 });
    expect(data.users.length).toBe(1);
    expect(data.users[0].id).toBe(1);
    expect(typeof data.users[0].email).toBe('string');
    archen.shutdown();
  });
});

describe('cursor pagination', () => {
  const connQuery = (argsStr: string) => `
    query {
      productsConnection(${argsStr}) {
        edges { node { id } cursor }
        pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
      }
    }
  `;
  const ids = (c: any) => c.edges.map((e: any) => e.node.id);

  test('forward and backward windows agree', async () => {
    const archen = await buildArchen();

    const page1: any = await archen.query(
      { source: connQuery('first: 3, orderBy: ["id"]') },
      'productsConnection'
    );
    expect(ids(page1)).toEqual([1, 2, 3]);
    expect(page1.pageInfo.hasNextPage).toBe(true);
    expect(page1.pageInfo.hasPreviousPage).toBe(false);

    const page2: any = await archen.query(
      {
        source: connQuery(
          `first: 3, after: "${page1.pageInfo.endCursor}", orderBy: ["id"]`
        )
      },
      'productsConnection'
    );
    expect(ids(page2)).toEqual([4, 5, 6]);
    expect(page2.pageInfo.hasPreviousPage).toBe(true);

    // Page backward from the start of page 2 (id 4).
    const cursorOf4 = page2.edges[0].cursor;
    const back: any = await archen.query(
      { source: connQuery(`last: 3, before: "${cursorOf4}", orderBy: ["id"]`) },
      'productsConnection'
    );
    expect(ids(back)).toEqual([1, 2, 3]);
    expect(back.pageInfo.hasPreviousPage).toBe(false);
    expect(back.pageInfo.hasNextPage).toBe(true);

    // A smaller backward window keeps requested order and flags a prev page.
    const back2: any = await archen.query(
      { source: connQuery(`last: 2, before: "${cursorOf4}", orderBy: ["id"]`) },
      'productsConnection'
    );
    expect(ids(back2)).toEqual([2, 3]);
    expect(back2.pageInfo.hasPreviousPage).toBe(true);

    archen.shutdown();
  });
});

describe('json filter', () => {
  type User = { id: number; email: string; meta: any };

  test('select json column', async () => {
    const archen = await buildArchen();
    const source = `
    query {
      users(where: { id: 1 }) {
        id
        meta
      }
    }
    `;
    const rows = await archen.query<User[]>({ source }, 'users');
    expect(rows.length).toBe(1);
    expect(rows[0].meta.role).toBe('admin');
    expect(rows[0].meta.address.city).toBe('NYC');
    archen.shutdown();
  });

  test('filter by enum literal value', async () => {
    // An unquoted value parses as a GraphQL enum literal; the JSON scalar
    // must accept it as a string.
    const archen = await buildArchen();
    const source = `
    query {
      users(where: { meta: { role: admin } }) {
        id
      }
    }
    `;
    const rows = await archen.query<User[]>({ source }, 'users');
    expect(rows.map(r => r.id)).toEqual([1]);
    archen.shutdown();
  });

  test('filter by nested scalar', async () => {
    const archen = await buildArchen();
    const source = `
    query {
      users(where: { meta: { role: "admin" } }) {
        id
      }
    }
    `;
    const rows = await archen.query<User[]>({ source }, 'users');
    expect(rows.map(r => r.id)).toEqual([1]);
    archen.shutdown();
  });

  test('filter by operator suffix', async () => {
    const archen = await buildArchen();
    const source = `
    query {
      users(where: { meta: { age__gt: 18 } }, orderBy: ["id"]) {
        id
      }
    }
    `;
    const rows = await archen.query<User[]>({ source }, 'users');
    expect(rows.map(r => r.id)).toEqual([1, 3]);
    archen.shutdown();
  });

  test('snake_case key with operator suffix stays literal', async () => {
    // With operatorDelimiter '__', a single-underscore key such as `opt_in`
    // is a document key, not the `in` operator.
    const archen = await buildArchen();
    const source = `
    query {
      users(where: { meta: { opt_in: "news" } }) {
        id
      }
    }
    `;
    const rows = await archen.query<User[]>({ source }, 'users');
    expect(rows.map(r => r.id)).toEqual([1]);
    archen.shutdown();
  });

  test('filter by nested path', async () => {
    const archen = await buildArchen();
    const source = `
    query {
      users(where: { meta: { address: { city: "NYC" } } }, orderBy: ["id"]) {
        id
      }
    }
    `;
    const rows = await archen.query<User[]>({ source }, 'users');
    expect(rows.map(r => r.id)).toEqual([1, 3]);
    archen.shutdown();
  });

  test('filter by array containment', async () => {
    const archen = await buildArchen();
    const source = `
    query {
      users(where: { meta: { tags__contains: "early" } }) {
        id
      }
    }
    `;
    const rows = await archen.query<User[]>({ source }, 'users');
    expect(rows.map(r => r.id)).toEqual([1]);
    archen.shutdown();
  });

  test('filter via variables', async () => {
    const archen = await buildArchen();
    const source = `
    query UserQuery($meta: JSON) {
      users(where: { meta: $meta }) {
        id
      }
    }
    `;
    const variableValues = { meta: { vip: true, age__gt: 40 } };
    const rows = await archen.query<User[]>(
      { source, variableValues },
      'users'
    );
    expect(rows.map(r => r.id)).toEqual([3]);
    archen.shutdown();
  });
});
