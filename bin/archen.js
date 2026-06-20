#!/usr/bin/env node

// Emit the generated GraphQL schema as SDL, so GraphQL codegen tools have a
// static schema to read. See docs/codegen.md.

const { Archen } = require('../dist');
const getopt = require('sqlex/lib/getopt');
const fs = require('fs');
const path = require('path');

const options = getopt(
  [
    ['  ', '--config'],
    ['  ', '--dialect'],
    ['-h', '--host'],
    ['-u', '--user'],
    ['-p', '--password'],
    ['  ', '--port'],
    ['  ', '--database'],
    ['  ', '--schemaInfo'],
    ['-o', '--out'],
    ['  ', '--exportGraphqlSchema'], // alias for --out (kept for compatibility)
  ],
  {
    dialect: 'mysql',
    host: 'localhost',
    user: 'root',
    password: 'secret',
    database: 'example',
  }
);

async function main() {
  const archen = new Archen(getArchenConfig(options));
  await archen.bootstrap();

  const sdl = archen.printSchema();
  const out = options.out || options.exportGraphqlSchema;
  if (out) {
    fs.writeFileSync(out, sdl);
    process.stderr.write(`Wrote ${out}\n`);
  } else {
    process.stdout.write(sdl);
  }

  await archen.shutdown();
}

function getArchenConfig(options) {
  if (options.config) {
    const mod = require(path.resolve(process.cwd(), options.config));
    return mod.default || mod;
  }
  let schemaInfo;
  if (options.schemaInfo) {
    schemaInfo = JSON.parse(fs.readFileSync(options.schemaInfo).toString());
  }
  return {
    database: {
      connection: {
        dialect: options.dialect,
        connection: {
          host: options.host,
          user: options.user,
          port: options.port,
          password: options.password,
          database: options.database,
          timezone: 'Z',
          connectionLimit: 2,
        },
      },
      schemaInfo,
    },
  };
}

main().catch((err) => {
  process.stderr.write(`${(err && err.stack) || err}\n`);
  process.exit(1);
});
