import * as helper from './helper';
import { Archen } from '../src/index';

const NAME = 'archen';

beforeAll(() => helper.createDatabase(NAME));
afterAll(() => helper.dropDatabase(NAME));

const buildArchen = async () => {
  const connection = helper.createTestConnectionPool(NAME);
  const archen = new Archen({ database: { connection } });
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
    archen.shutdown();
  });
});
