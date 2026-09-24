let _table: string | null = null;
let _schema: string | null = null;

export const dragState = {
  get table() { return _table; },
  get schema() { return _schema; },
  start(name: string, schema?: string | null) {
    _table = name;
    _schema = schema || null;
  },
  clear() {
    _table = null;
    _schema = null;
  },
};
