// Used by `npm run export-schema` (the `archen` CLI) to introspect the database
// and write etc/schema.graphql. Mirrors the connection in lib/graphql.ts.
module.exports = {
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
};
