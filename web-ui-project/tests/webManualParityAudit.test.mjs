import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function tableRows(document, header) {
  const lines = document.split("\n");
  const headerIndex = lines.indexOf(header);
  expect(headerIndex, `Missing table header: ${header}`).not.toBe(-1);

  const rows = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.startsWith("|")) break;
    rows.push(line.slice(1, -1).split("|").map((cell) => cell.trim()));
  }
  return rows;
}

test("the signed manual audit covers every planned parity area", () => {
  const planRows = tableRows(
    read("web-ui-project/docs/WEB_UI_PLAN.md"),
    "| Area | Web behavior | Parity type | Primary transport needs |",
  );
  const auditRows = tableRows(
    read("web-ui-project/docs/WEB_MANUAL_PARITY_AUDIT.md"),
    "| Area | Desktop evidence | Web evidence | Adaptation rationale | Known limitation | Test reference | Reviewer sign-off |",
  );

  const plannedAreas = planRows.map(([area]) => area);
  const auditedAreas = auditRows.map(([area]) => area);
  expect(auditedAreas).toEqual(plannedAreas);

  for (const row of auditRows) {
    expect(row, `Unexpected audit column count for ${row[0]}`).toHaveLength(7);
    for (const cell of row) {
      expect(cell, `Empty audit evidence for ${row[0]}`).not.toHaveLength(0);
      expect(cell, `Unresolved audit value for ${row[0]}`).not.toMatch(
        /\b(?:unknown|tbd|todo)\b/i,
      );
      expect(cell, `Missing audit value for ${row[0]}`).not.toBe("—");
    }
    const references = [...row[5].matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    expect(references, `Missing test reference for ${row[0]}`).not.toHaveLength(0);
    for (const reference of references) {
      expect(
        fs.existsSync(path.join(root, reference)),
        `Missing referenced evidence ${reference} for ${row[0]}`,
      ).toBe(true);
    }
    expect(row[6], `Missing reviewer approval for ${row[0]}`).toMatch(
      /^Approved by Web UI parity reviewer on \d{4}-\d{2}-\d{2}$/,
    );
  }
});
