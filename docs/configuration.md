# Configuration

Archen is configured with a single `ArchenConfig` object passed to the
constructor.

```js
const archen = new Archen({
  database: { /* connection, schema source, JSON options */ },
  schema:   { /* sqlex schema config (optional) */ },
  accessor: { /* default limit, lifecycle callbacks (optional) */ },
  graphql:  { /* generated-API options (optional) */ },
});
```

| Key        | Purpose                                                              |
| ---------- | ------------------------------------------------------------------- |
| `database` | Connection and how the schema is obtained                           |
| `schema`   | sqlex schema configuration (model/field overrides, closure tables)  |
| `accessor` | Default page size and [lifecycle callbacks](./hooks.md)             |
| `graphql`  | [Access control](./access-control.md) and schema-generation options |

## `database`

```ts
database: {
  connection: ConnectionPool | ConnectionInfo;
  schemaInfo?: SchemaInfo;
  jsonFilterOptions?: JsonFilterOptions;
}
```

### `connection`

Either a sqlex `ConnectionPool` or a `ConnectionInfo` describing how to connect.
`dialect` selects the driver; `connection` is passed through to it.

```js
// MySQL
connection: {
  dialect: 'mysql',
  connection: {
    host: '127.0.0.1',
    user: 'root',
    password: 'secret',
    database: 'example',
    connectionLimit: 10,
  },
}

// PostgreSQL
connection: { dialect: 'postgres', connection: { host, user, password, database } }

// SQLite
connection: { dialect: 'sqlite3', connection: { database: './data.db' } }
```

If you already manage a pool, pass it directly so archen reuses it.

### `schemaInfo` — skip introspection

By default `bootstrap()` introspects the database. To supply the schema yourself
(faster cold starts, or environments where introspection isn't available), pass
a `schemaInfo` object — the same JSON shape sqlex produces:

```js
import schema from './schema.json';

const archen = new Archen({
  database: { connection, schemaInfo: schema },
});
await archen.bootstrap();
```

You can also pass it directly to bootstrap: `archen.bootstrap(schemaInfo)`.
Introspection is supported on MySQL, PostgreSQL and SQLite.

### `jsonFilterOptions`

Controls how operators are written inside `json`/`jsonb` filters. Defaults to
`{ operatorSyntax: 'both', operatorDelimiter: '__' }`. See
[JSON fields](./json-fields.md) for details.

## `accessor`

```ts
accessor: {
  defaultLimit?: number;            // default 100
  callbacks?: {
    context?: any;
    onQuery?: Callback;
    onResult?: Callback;
    onError?: Callback;
  };
}
```

- `defaultLimit` caps list queries that don't specify their own `limit`, so a
  bare `users { id }` won't read an entire table.
- `callbacks` hook into every operation — see [Hooks](./hooks.md).

## `graphql`

```ts
graphql: {
  useWhereForGetOne?: boolean;      // default false
  allowAll?: boolean;               // default true
  models?: { [name: string]: boolean | ModelConfig };
  getAccessor?: (context: any) => Accessor;
  operators?: { [key: string]: string };
}
```

- `allowAll` / `models` control which models and operations are exposed — see
  [Access control](./access-control.md).
- `useWhereForGetOne` wraps single-row query/delete arguments in a `where`
  field instead of spreading the unique-key fields at the top level — see
  [Querying](./querying.md#get-a-single-row).
- `getAccessor` maps the GraphQL context value to an `Accessor`. By default the
  context value **is** the accessor (as in the examples here). Override it when
  your context is, say, `{ accessor, user }`.

## Lifecycle

```ts
class Archen {
  constructor(config: ArchenConfig);
  bootstrap(schemaInfo?, operators?): Promise<void>;
  query<T>(args: QueryArgs, dataKey?: string): Promise<T>;
  shutdown(): Promise<void>;   // closes the connection pool
}
```

Call `bootstrap()` once, reuse the instance for all requests, and `shutdown()`
on process exit (or when you're done, e.g. in tests).
