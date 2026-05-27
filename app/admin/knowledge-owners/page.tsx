import { redirect } from "next/navigation";

export default async function KnowledgeOwnersRedirect() {
  redirect("/admin/agents?tab=owners");
}
