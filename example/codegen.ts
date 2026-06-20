import type { CodegenConfig } from '@graphql-codegen/cli';

// Generates typed GraphQL operations into ./gql from the archen schema.
// Regenerate the schema with `npm run export-schema` whenever the database
// changes, then run `npm run codegen`.
const config: CodegenConfig = {
  schema: './etc/schema.graphql',
  documents: ['lib/**/*.ts', 'app/**/*.{ts,tsx}'],
  ignoreNoDocuments: true,
  generates: {
    './gql/': {
      preset: 'client',
    },
  },
};

export default config;
