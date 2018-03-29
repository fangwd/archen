import { Connection, Escape, Row } from './connection';

function createConnection(engine: string, options: any) {
  if (engine === 'mysql') {
    return require('./mysql').default(options);
  }
}

export { Connection, Escape, Row, createConnection };
