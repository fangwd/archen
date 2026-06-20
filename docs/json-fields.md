# JSON fields

A `json` / `jsonb` column is exposed as a custom `JSON` scalar. You can select
it, write it in mutations, and filter into the stored document.

## Reading and writing

Selecting a JSON column returns the parsed value; writing accepts any JSON:

```graphql
mutation {
  createUser(data: {
    email: "alice@example.com"
    meta: { role: "admin", age: 30, tags: ["vip", "early"], address: { city: "NYC" } }
  }) {
    id
    meta
  }
}
```

Inline object/array/scalar literals are supported, as are enum-like bare words
(`role: admin` is read as the string `"admin"`). To pass a whole document, use a
variable typed `JSON`.

## Filtering

A JSON column takes a **nested filter object** that descends into the document.
Each key is a key in the stored JSON; nest objects to go deeper, or use a dotted
key as shorthand.

```graphql
query {
  users(where: {
    meta: {
      role: "admin"                 # meta -> role = 'admin'
      age__gt: 18                   # (meta -> age) > 18
      vip: true                     # meta -> vip is true
      role__in: ["admin", "editor"] # meta -> role in (...)
      "address.city": "NYC"         # meta -> address -> city = 'NYC'
      address: { zip__like: "100%" } # meta -> address -> zip like '100%'
    }
  }) {
    email
  }
}
```

### Operators

The same operators as regular fields apply, written as **suffixes with a double
underscore** (`age__gt`, `name__ne`, `role__in`, `zip__like`, `field__null`),
plus two JSON-specific forms:

| Form              | Meaning                                                   |
| ----------------- | --------------------------------------------------------- |
| `field__contains` | the JSON value at `field` contains the scalar value       |
| `field__null`     | `field` is JSON `null` **or** absent                      |

```graphql
# meta.tags is an array containing 'vip'
users(where: { meta: { tags__contains: "vip" } }) { email }
```

## Why the double underscore?

Top-level operators use a single underscore (`price_gt`), but JSON document keys
are arbitrary user data, and many snake_case keys end in an operator word
(`opt_in`, `logged_in`). With a single-underscore delimiter, `opt_in` would be
misread as the path `opt` with the `in` operator. The double underscore keeps
such keys literal while still supporting `age__gt`-style operators.

The default is `{ operatorSyntax: 'both', operatorDelimiter: '__' }`, set on
`database.jsonFilterOptions`:

```js
new Archen({
  database: {
    connection,
    jsonFilterOptions: { operatorSyntax: 'both', operatorDelimiter: '_' },
  },
});
```

| Option             | Values                            | Default  |
| ------------------ | --------------------------------- | -------- |
| `operatorDelimiter`| `'_'` or `'__'`                   | `'__'`   |
| `operatorSyntax`   | `'suffix'`, `'explicit'`, `'both'`| `'both'` |

## The explicit `$` form (variables only)

sqlex also accepts an explicit `$`-prefixed operator form
(`{ age: { $gt: 18 } }`). In an **inline** GraphQL query this is a syntax error —
`$` starts a variable — so it is only reachable when the filter is passed as a
variable:

```graphql
query ($meta: JSON) {
  users(where: { meta: $meta }) { email }
}
```

```js
archen.query({
  source,
  variableValues: { meta: { age: { $gt: 18 }, tags: { $contains: "vip" } } },
});
```

This is useful for keys that even `__` can't disambiguate. Every suffix operator
has a `$` equivalent (`$eq`, `$ne`, `$lt`, `$le`, `$gt`, `$ge`, `$in`, `$notIn`,
`$like`, `$ilike`, `$null`, `$contains`).

JSON-path filtering works on PostgreSQL, MySQL and SQLite.
