import { redirect } from "next/navigation";

export default function AccessRoute() {
  // Access is agent-owned now; this page is deprecated.
  redirect("/agents");
}
