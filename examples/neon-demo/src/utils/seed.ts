import 'server-only';
import {sql} from './db';
export async function seedWorkspace(userId: string) {
    const existing =
        await sql`SELECT id FROM tabularis_demo.projects WHERE owner_id = ${userId} LIMIT 1`;
    if (existing.length) return;
    await sql`WITH project AS (
    INSERT INTO tabularis_demo.projects(owner_id, name, color) VALUES (${userId}, 'Product research', '#5577ca')
    ON CONFLICT (owner_id, name) DO NOTHING RETURNING id
  ) INSERT INTO tabularis_demo.notes(owner_id, project_id, title, body)
  SELECT ${userId}, id, 'A quieter place to think', ${'The best tools disappear into the work.\n\nWe are exploring how a small research team can capture observations, connect ideas, and keep a clear record of decisions.\n\nWhat we heard\n• People want one place for notes and source material.\n• Small, private workspaces make unfinished ideas easier to share.\n• Seeing changes immediately helps teams stay in the same conversation.\n\nNext steps\nInterview three researchers this week. Bring the findings into our next product review, and test a focused writing experience before adding more features.'} FROM project`;
    await sql`WITH project AS (
    INSERT INTO tabularis_demo.projects(owner_id, name, color) VALUES (${userId}, 'Field journal', '#398b78')
    ON CONFLICT (owner_id, name) DO NOTHING RETURNING id
  ) INSERT INTO tabularis_demo.notes(owner_id, project_id, title, body)
  SELECT ${userId}, id, 'Friday observations', ${'A good question changes the direction of a conversation.\n\nToday we watched a participant work through their research notes. They did not search by title: they remembered the project, the person, and a small detail from the session.\n\nA useful direction: make context visible without taking attention away from the page.'} FROM project`;
}
