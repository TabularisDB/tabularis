export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { auth } from "@/utils/auth";
export default async function Home() {
  const { data } = await auth.getSession();
  redirect(data?.user ? "/workspace" : "/auth/sign-in");
}
