import { useCallback, useEffect, useRef, useState } from "react";

/** Tracks editable secondary windows, including the asynchronous opening phase. */
export function useJsonEditorActivity() {
  const [count, setCount] = useState(0);
  const active = useRef(new Set<symbol>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const activeEditors = active.current;
    return () => {
      mounted.current = false;
      activeEditors.clear();
    };
  }, []);

  const begin = useCallback(() => {
    const token = Symbol();
    active.current.add(token);
    setCount(active.current.size);
    return () => {
      active.current.delete(token);
      if (mounted.current) setCount(active.current.size);
    };
  }, []);

  const isEditing = useCallback(() => active.current.size > 0, []);
  return { count, begin, isEditing };
}
