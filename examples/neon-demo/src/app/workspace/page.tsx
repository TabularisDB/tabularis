export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { auth } from "@/utils/auth";
import { sql } from "@/utils/db";
import { seedWorkspace } from "@/utils/seed";
import { sealNotes } from "@/utils/realtime";
import { Workspace } from "@/components/Workspace";
import type { Note, Project } from "@/utils/types";
export default async function WorkspacePage() {
  const { data } = await auth.getSession();
  if (!data?.user) redirect("/auth/sign-in");
  const user = data.user;
  await seedWorkspace(user.id);
  const [projects, notes, sealed] = await Promise.all([
    sql`SELECT id, name, color FROM tabularis_demo.projects WHERE owner_id = ${user.id} ORDER BY created_at`,
    sql`SELECT id, project_id, title, body, summary, created_at, updated_at FROM tabularis_demo.notes WHERE owner_id = ${user.id} ORDER BY updated_at DESC LIMIT 200`,
    sealNotes(user.id),
  ]);
  return (
    <Workspace
      user={{ id: user.id, name: user.name, email: user.email }}
      initialProjects={projects as Project[]}
      initialNotes={notes as Note[]}
      sealed={sealed}
      realtimeUrl={process.env.NEON_REALTIME_URL!}
    />
  );
}
