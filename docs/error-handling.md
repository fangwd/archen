# Error handling

When a GraphQL operation produces errors, `archen.query()` throws a
`GraphQLQueryError`. The thrown error keeps the human-readable message but also
carries the structured GraphQL errors and any partial data.

```ts
import { Archen, GraphQLQueryError } from 'archen';

try {
  await archen.query({ source });
} catch (err) {
  if (err instanceof GraphQLQueryError) {
    err.message;   // newline-joined error messages
    err.errors;    // readonly GraphQLError[] — with path, locations, extensions
    err.data;      // partial data, if any fields resolved
  }
}
```

| Property  | Type                  | Description                                   |
| --------- | --------------------- | --------------------------------------------- |
| `message` | `string`              | All error messages joined with newlines       |
| `errors`  | `readonly GraphQLError[]` | The raw errors, with `path`/`locations`/`extensions` |
| `data`    | `unknown`             | Any partial data returned alongside the errors |

When there are no errors, `query()` resolves with the data (or `data[dataKey]`
if you pass a `dataKey`).

## Forbidden operations

If an [`onQuery`/`onResult` hook](./hooks.md) returns `false`, the operation is
rejected with `Error('Forbidden')`, which surfaces as a `GraphQLQueryError`:

```js
const data = await archen.query({ source }).catch((err) => {
  if (err.errors?.some((e) => e.message === 'Forbidden')) {
    // handle authorization failure
  }
  throw err;
});
```

## Serving errors over HTTP

A request handler typically maps the structured errors into a GraphQL-shaped
response:

```js
export async function handler(req, res) {
  try {
    const data = await archen.query({ source: req.body.query });
    res.json({ data });
  } catch (err) {
    if (err instanceof GraphQLQueryError) {
      res.status(400).json({ data: err.data, errors: err.errors });
    } else {
      res.status(500).json({ errors: [{ message: 'Internal error' }] });
    }
  }
}
```

Transform or log errors centrally with the [`onError` hook](./hooks.md#onerror).
