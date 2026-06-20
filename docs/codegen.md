# Typed queries (codegen)

`archen.query()` accepts either a source string or a **`TypedDocumentNode`**.
With a typed document — produced by [GraphQL Code
Generator](https://the-guild.dev/graphql/codegen) from the generated schema —
the result and variables are fully typed, with no hand-written interfaces.

The workflow is: **export the schema as SDL → run codegen against it → pass the
typed documents to `query()`**.

## 1. Export the schema as SDL

The schema is generated from your database, so first write it to a file.

Using the CLI (installed as the `archen` bin):

```sh
# from connection flags
npx archen schema --dialect mysql -h 127.0.0.1 -u root -p secret --database example --out schema.graphql

# or from a config module that exports an ArchenConfig
npx archen schema --config archen.config.js --out schema.graphql
```

Or programmatically:

```js
import { writeFileSync } from 'fs';

await archen.bootstrap();
writeFileSync('schema.graphql', archen.printSchema());
```

Regenerate `schema.graphql` whenever the database schema changes (a good
`prebuild` / CI step).

## 2. Configure GraphQL Code Generator

```sh
npm i -D @graphql-codegen/cli @graphql-codegen/client-preset
```

`codegen.ts`:

```ts
import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  schema: './schema.graphql',
  documents: ['src/**/*.{ts,tsx}'],
  generates: {
    './src/gql/': { preset: 'client' },
  },
};
export default config;
```

```sh
npx graphql-codegen
```

The `client` preset emits a `graphql()` helper that returns
`TypedDocumentNode<Result, Variables>` for each operation you write.

## 3. Write typed queries

```ts
import { graphql } from './gql';

const GetUser = graphql(`
  query GetUser($id: Int!) {
    users(where: { id: $id }) {
      id
      email
    }
  }
`);

// data is typed as { users: { id: number; email: string }[] }
const data = await archen.query(GetUser, { id: 1 });
```

`query(document, variables)` infers the result from the document and
type-checks `variables` against it. The string form remains available for
untyped/ad-hoc use:

```ts
const data = await archen.query<{ users: any[] }>({ source }, 'users');
```

## Notes

- Any tool that reads a GraphQL SDL works the same way — for example
  [`gql.tada`](https://gql-tada.0no.co/), or the `typed-document-node` plugin.
- The typed `query()` overload uses the standard
  [`@graphql-typed-document-node/core`](https://www.npmjs.com/package/@graphql-typed-document-node/core)
  type, so documents from any compatible generator are accepted.
- For richer types of nested filters and JSON columns, the SDL already carries
  the generated input types (`FilterUserInput`, the `JSON` scalar, …), so codegen
  types your `where` arguments too.
