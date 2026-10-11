import ClientApp from "../client-app";
import { getCurrentUser } from "@server/auth/session";

/**
 * ARCH: persistent client shell.
 *
 * Every app route lives in this route group and its page.tsx renders nothing;
 * ClientApp picks the screen from the pathname. Because a shared layout is
 * kept mounted across client-side navigations (only the changed page segment
 * is re-rendered), the providers, sidebar, cached page state and the realtime
 * stream all survive sidebar clicks. Previously each page.tsx rendered its own
 * ClientApp, so every navigation rebuilt the whole tree and refetched
 * everything.
 *
 * The session is read once per full page load; afterwards AuthProvider owns
 * the in-memory user (login/logout/visibility revalidation update it).
 */
export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const initialUser = await getCurrentUser();
  return (
    <>
      {children}
      <ClientApp initialUser={initialUser} />
    </>
  );
}
