import { redirect } from "next/navigation";
import { NorthstarShell } from "@/components/Northstar";
import { getCurrentNorthstarUser } from "@/lib/northstar-auth";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentNorthstarUser();
  if (!user) redirect("/login");
  return <NorthstarShell user={user}>{children}</NorthstarShell>;
}
