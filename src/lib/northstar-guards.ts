import { redirect } from "next/navigation";

import { getCurrentNorthstarUser } from "@/lib/northstar-auth";
import { canViewNorthstarModule } from "@/lib/northstar-permissions";

export async function requireNorthstarModuleAccess(module: string) {
  const user = await getCurrentNorthstarUser();
  if (!user) redirect("/login");
  if (!canViewNorthstarModule(user, module)) redirect("/erp/dashboard");
  return user;
}
