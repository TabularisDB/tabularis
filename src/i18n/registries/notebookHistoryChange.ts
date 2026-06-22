import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

export const notebookHistoryChange: Record<string, MessageDescriptor> = {
  initial: msg`Initial version`,
  editCell: msg({ message: "Edited cell {n}" }),
  addSql: msg({ message: "Added SQL cell {n}" }),
  addMarkdown: msg({ message: "Added Markdown cell {n}" }),
  deleteCell: msg({ message: "Deleted cell {n}" }),
  reorder: msg`Reordered cells`,
  renameCell: msg({ message: "Renamed cell {n}" }),
  schemaCell: msg({ message: "Changed database (cell {n})" }),
  chartCell: msg({ message: "Changed chart (cell {n})" }),
  parallelCell: msg({ message: "Toggled parallel (cell {n})" }),
  collapse: msg`Collapsed/expanded cells`,
  params: msg`Changed parameters`,
  stopOnError: msg`Toggled stop on error`,
  other: msg`Edited notebook`,
};
