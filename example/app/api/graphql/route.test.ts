import { POST } from '@/app/api/graphql/route';

const endpoint = 'http://localhost:3000/api/graphql';

describe('GraphQL API', () => {
  it('should return query results', async () => {
    const query = `
    query Order ($limit: Int) {
          orders(limit: $limit) {
              id
              user {
                firstName
                email
              }
              orderItems {
                product {
                  name
                  price
                }
                quantity
            }
        }
    }`;
    const variables = { limit: 1 };
    const req = new Request(endpoint, {
      method: 'POST',
      body: JSON.stringify({ query, variables }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    const { data } = await res.json();
    expect(res.status).toBe(200);
    expect(data.orders.length).toBe(1);
  });
});
