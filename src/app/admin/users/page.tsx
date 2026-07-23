import { listRoleRequests, listUsers } from "@/db/admin";
import { requireViewer } from "@/lib/viewer";
import { UsersAdmin } from "./users-admin";

export const dynamic = "force-dynamic";

export default async function AdminUsers() {
  await requireViewer("admin"); // re-assert per page (a shared layout guard doesn't re-run on soft nav)
  const [users, requests] = await Promise.all([listUsers(), listRoleRequests()]);
  return (
    <main>
      <div className="eyebrow">Admin</div>
      <h1>Users &amp; roles</h1>
      <p className="sub">Review role requests, promote/demote organizer &amp; admin roles, and set student departments (which drive department-scoped fees).</p>
      <UsersAdmin users={users} requests={requests} />
    </main>
  );
}
