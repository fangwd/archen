import { Archen, QueryArgs } from 'archen';

// Build the GraphQL API once and reuse it across requests. Archen introspects
// the database on bootstrap, so no schema file is needed — point it at a
// connection and the full CRUD + query API is generated.
let instance: Promise<Archen> | undefined;

export function getArchen(): Promise<Archen> {
  if (!instance) {
    const archen = new Archen({
      database: {
        connection: {
          dialect: 'mysql',
          connection: {
            host: process.env.DB_HOST || '127.0.0.1',
            port: +(process.env.DB_PORT || 3307),
            user: process.env.DB_USER || 'archen',
            password: process.env.DB_PASS || 'secret',
            database: process.env.DB_NAME || 'archen_demo',
          },
        },
      },
    });
    instance = archen
      .bootstrap()
      .then(() => archen)
      .catch((error) => {
        // Don't cache a failed bootstrap (e.g. the database isn't up yet).
        instance = undefined;
        throw error;
      });
  }
  return instance;
}

export async function query(args: QueryArgs) {
  const archen = await getArchen();
  return archen.query(args);
}
