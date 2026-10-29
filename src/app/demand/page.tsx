import { redirect } from "next/navigation";

export default function DemandRootPage() {
  redirect("/leads");
  return null;
}
