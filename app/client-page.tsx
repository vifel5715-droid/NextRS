import ClientApp from "./client-app";
import { getCurrentUser } from "@server/auth/session";

export default async function ClientPage() {
  const initialUser = await getCurrentUser();
  return <ClientApp initialUser={initialUser} />;
}
