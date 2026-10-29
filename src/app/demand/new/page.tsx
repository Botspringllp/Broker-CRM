import { redirect } from "next/navigation";

export default function DemandNewPage() {
  redirect("/leads/new");
  return null;
}
