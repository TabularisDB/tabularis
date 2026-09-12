# React Rules
1. **Exhaustive Deps:** Always provide all dependencies to `useEffect`, `useMemo`, and `useCallback`. If a function is a dependency, ensure it is wrapped in `useCallback` or defined inside the hook.
2. **Sync State in Effects:** NEVER call `setState` synchronously inside `useEffect`. This triggers unnecessary cascading renders. Use `useMemo` for derived state or initialize state directly if possible.
3. **Fast Refresh Compatibility:** Files exporting React components (especially Contexts) must NOT export other constants or helper functions. Move helpers to separate utility files.
4. **Library Safety:** Be aware of incompatible libraries with the React Compiler (e.g., `useReactTable`). Do not wrap their return values in `useMemo` if the library manages its own internal memoization or returns unstable function references.
