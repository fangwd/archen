import helper = require('./helper');

const NAME = 'engine';

beforeAll(() => helper.createDatabase(NAME));
afterAll(() => helper.dropDatabase(NAME));

test('select/update', done => {
  expect.assertions(1);

  const conn = helper.createTestConnection(NAME);
  conn.query('update product set status=200 where id=1').then(rows => {
    conn.query('select * from product where id=1').then(rows => {
      expect(rows[0].status).toBe(200);
      done();
    });
  });
});

test('transaction commit', done => {
  expect.assertions(3);

  const ID = 100;

  const conn = helper.createTestConnection(NAME);
  conn
    .transaction(conn => {
      return conn
        .query(`insert into category (id, name) values (${ID}, 'Grocery')`)
        .then(id => {
          return conn
            .query(`select * from category where id=${ID}`)
            .then(rows => {
              expect(rows[0].name).toBe('Grocery');
              return conn.query(
                `insert into category(id, name) values (${ID + 1}, 'Dairy')`
              );
            });
        });
    })
    .then(() => {
      conn
        .query(
          `select * from category where id in (${ID}, ${ID + 1}) order by id`
        )
        .then(rows => {
          expect(rows.length).toBe(2);
          expect(rows[1].name).toBe('Dairy');
          done();
        });
    });
});

test('transaction rollback - bad column', done => {
  expect.assertions(3);

  const ID = 200;

  const conn = helper.createTestConnection(NAME);
  conn
    .transaction(conn => {
      return conn
        .query(`insert into category (id, name) values (${ID}, 'Grocery')`)
        .then(id => {
          return conn
            .query(`select * from category where id=${ID}`)
            .then(rows => {
              expect(rows[0].name).toBe('Grocery');
              return conn.query(
                `insert into category(id, name, x) values (${ID + 1}, 'Dairy')`
              );
            });
        });
    })
    .catch(reason => {
      expect(!!reason).toBe(true);
      conn
        .query(
          `select * from category where id in (${ID}, ${ID + 1}) order by id`
        )
        .then(rows => {
          expect(rows.length).toBe(0);
          done();
        });
    });
});

test('transaction rollback - bad value', done => {
  expect.assertions(3);

  const ID = 300;

  const conn = helper.createTestConnection(NAME);
  conn
    .transaction(conn => {
      return conn
        .query(`insert into category (id, name) values (${ID}, 'Grocery')`)
        .then(id => {
          return conn
            .query(`select * from category where id=${ID}`)
            .then(rows => {
              expect(rows[0].name).toBe('Grocery');
              return conn.query(
                `insert into category(d, name, parent_id) values (${ID +
                  1}, 'Dairy', -1)`
              );
            });
        });
    })
    .catch(reason => {
      expect(!!reason).toBe(true);
      conn
        .query(
          `select * from category where id in (${ID}, ${ID + 1}) order by id`
        )
        .then(rows => {
          expect(rows.length).toBe(0);
          done();
        });
    });
});

test('transaction rollback - error', done => {
  expect.assertions(3);

  const ID = 400;

  const conn = helper.createTestConnection(NAME);
  conn
    .transaction(conn => {
      return conn
        .query(`insert into category (id, name) values (${ID}, 'Grocery')`)
        .then(id => {
          return conn
            .query(`select * from category where id=${ID}`)
            .then(rows => {
              expect(rows[0].name).toBe('Grocery');
              throw Error('Aborted');
            });
        });
    })
    .catch(reason => {
      expect(!!reason).toBe(true);
      conn
        .query(
          `select * from category where id in (${ID}, ${ID + 1}) order by id`
        )
        .then(rows => {
          expect(rows.length).toBe(0);
          done();
        });
    });
});

test('transaction commit (by user)', done => {
  expect.assertions(3);

  const ID = 500;

  const conn = helper.createTestConnection(NAME);
  conn.transaction(conn =>
    conn
      .query(`insert into category (id, name) values (${ID}, 'Grocery')`)
      .then(id => {
        return conn
          .query(`select * from category where id=${ID}`)
          .then(rows => {
            expect(rows[0].name).toBe('Grocery');
            return conn
              .query(
                `insert into category(id, name) values (${ID + 1}, 'Dairy')`
              )
              .then(() =>
                conn.commit().then(() =>
                  conn
                    .query(
                      `select * from category where id in (${ID}, ${ID +
                        1}) order by id`
                    )
                    .then(rows => {
                      expect(rows.length).toBe(2);
                      expect(rows[1].name).toBe('Dairy');
                      done();
                    })
                )
              );
          });
      })
  );
});

test('transaction rollback (by user)', done => {
  expect.assertions(2);

  const ID = 600;

  const conn = helper.createTestConnection(NAME);
  conn.transaction(conn => {
    conn
      .query(`insert into category (id, name) values (${ID}, 'Grocery')`)
      .then(id =>
        conn.query(`select * from category where id=${ID}`).then(rows => {
          expect(rows[0].name).toBe('Grocery');
          conn
            .query(`insert into category(id, name) values (${ID + 1}, 'Dairy')`)
            .then(() => {
              conn.rollback().then(() =>
                conn
                  .query(
                    `select * from category where id in (${ID}, ${ID +
                      1}) order by id`
                  )
                  .then(rows => {
                    expect(rows.length).toBe(0);
                    done();
                  })
              );
            });
        })
      );
  });
});

test('pool', done => {
  const pool = helper.createTestConnectionPool(NAME);
  pool.getConnection().then(connection => {
    connection.query('SELECT 1 + 1 AS solution').then(result => {
      expect(result[0].solution).toBe(2);
      connection.release();
      pool.getConnection().then(connection2 => {
        expect(connection2.connection).toBe(connection.connection);
        done();
      });
    });
  });
});
