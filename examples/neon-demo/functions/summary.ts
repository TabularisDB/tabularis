import { createRemoteJWKSet, jwtVerify } from "jose";
import pg from "pg";

const jwks = createRemoteJWKSet(new URL(process.env.NEON_AUTH_JWKS_URL!));
const issuer = new URL(process.env.NEON_AUTH_BASE_URL!).origin;
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL!.replace(
    "sslmode=require",
    "sslmode=verify-full",
  ),
  max: 3,
});
pool.on("error", () => console.error("Database connection interrupted"));

// The Function independently authenticates and authorizes stored rows.
export default async function summary(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer "))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  let userId: string;
  try {
    const { payload } = await jwtVerify(authorization.slice(7), jwks, {
      issuer,
      algorithms: ["EdDSA"],
    });
    if (!payload.sub) throw new Error("Missing subject");
    userId = payload.sub;
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (request.method !== "POST")
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  const input: unknown = await request.json().catch(() => null);
  if (
    !input ||
    typeof input !== "object" ||
    !("noteId" in input) ||
    typeof input.noteId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(input.noteId)
  ) {
    return Response.json(
      { error: "A valid noteId is required" },
      { status: 400 },
    );
  }
  const { rows } = await pool.query<{
    id: string;
    title: string;
    body: string;
  }>(
    "SELECT id, title, body FROM tabularis_demo.notes WHERE id = $1::uuid AND owner_id = $2",
    [input.noteId, userId],
  );
  const note = rows[0];
  if (!note) return Response.json({ error: "Note not found" }, { status: 404 });
  const words = note.body.trim().split(/\s+/).filter(Boolean).length;
  return Response.json({
    service: "Neon Functions",
    noteId: note.id,
    title: note.title,
    ownerId: userId,
    words,
    readingMinutes: Math.max(1, Math.ceil(words / 220)),
    checkedAt: new Date().toISOString(),
  });
}
