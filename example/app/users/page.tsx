import { getRecentUsers } from '@/lib/queries';

// Rendered per request so it reflects the live database.
export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const users = await getRecentUsers();
  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Users</h1>
      <p>Fetched with a typed query (see lib/queries.ts).</p>
      <ul>
        {users.map((user) => (
          <li key={user.id}>{user.email}</li>
        ))}
      </ul>
    </main>
  );
}
