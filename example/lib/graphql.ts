import { Archen, QueryArgs } from 'archen';
import schema from '@/etc/schema.json';

export async function query(args: QueryArgs) {
  const archen = new Archen({
    database: {
      connection: {
        dialect: 'mysql',
        connection: {
          user: process.env.DB_USER,
          password: process.env.DB_PASS,
          database: process.env.DB_NAME,
          port: +(process.env.DB_PORT || 3306),
        },
      },
    },
  });
  await archen.bootstrap(schema);
  const data = await archen.query(args);
  await archen.shutdown();
  return data;
}
