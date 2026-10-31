import "server-only";
import { createRealtime, rawSql } from "@neon/realtime/server";
import type { Note } from "./types";
const realtime = createRealtime({
  secret: process.env.NEON_REALTIME_SECRET!,
  db: new URL(process.env.DATABASE_URL!).pathname.slice(1),
});
export function sealNotes(userId: string) {
  return realtime.seal({
    query: rawSql<Note>(
      "SELECT id, project_id, title, body, summary, updated_at, created_at FROM tabularis_demo.notes WHERE owner_id = $1 ORDER BY updated_at DESC, id DESC LIMIT 200",
      [userId],
    ),
  });
}
