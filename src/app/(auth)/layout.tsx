import ClientApp from "@/components/layout/ClientApp";
import { getCurrentUser } from "@/lib/session";

/**
 * Login and Unauthorized screens. Same client shell as (dashboard) so the
 * login form can hand the signed-in user to AuthProvider and the shell can
 * send an already-signed-in visitor on to their dashboard.
 */
export default async function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const initialUser = await getCurrentUser();
  return (
    <>
      {children}
      <ClientApp initialUser={initialUser} />
    </>
  );
}
