import { redirect } from "next/navigation";
import ClientApp from "@/components/layout/ClientApp";
import { getCurrentUser } from "@/lib/session";

/**
 * ARCH: persistent client shell.
 *
 * Every signed-in route lives in this route group and its page.tsx renders
 * nothing; ClientApp picks the screen from the pathname. Because a shared
 * layout is kept mounted across client-side navigations (only the changed
 * page segment is re-rendered), the providers, sidebar, cached page state and
 * the realtime stream all survive sidebar clicks.
 *
 * The session is read once per full page load; afterwards AuthProvider owns
 * the in-memory user (login/logout/visibility revalidation update it). An
 * anonymous full page load is redirected here on the server rather than
 * flashing the client shell first. Per-screen permission checks still happen
 * in ClientApp for UX, and independently in every Server Action/Route Handler
 * for security — this redirect is not the security boundary.
 */
export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const initialUser = await getCurrentUser();
  if (!initialUser) redirect("/login");
  return (
    <>
      {children}
      <ClientApp initialUser={initialUser} />
    </>
  );
}
