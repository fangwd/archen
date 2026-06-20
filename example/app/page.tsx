'use client';

import { createGraphiQLFetcher } from '@graphiql/toolkit';
import { GraphiQL } from 'graphiql';
import 'graphiql/style.css';

import styles from './page.module.css';

const fetcher = createGraphiQLFetcher({
  url: 'http://localhost:3000/api/graphql',
  fetch,
});

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <GraphiQL fetcher={fetcher} />
      </main>
    </div>
  );
}
