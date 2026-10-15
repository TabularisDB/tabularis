/** A user-defined colored label assignable to any number of connections. */
export interface ConnectionTag {
  id: string;
  name: string;
  /** CSS hex color, e.g. "#f97316". */
  color: string;
}
