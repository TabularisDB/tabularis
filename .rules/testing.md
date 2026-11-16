# Testing Conventions

This document defines the testing conventions and directory structure for the Tabularis project.

## Directory Structure

### Source Files
All utility functions and testable logic must be placed in `packages/web-ui/src/utils/` with simple, descriptive names **without the "Utils" suffix**.

**Correct:**
- `packages/web-ui/src/utils/dataGrid.ts`
- `packages/web-ui/src/utils/contextMenu.ts`
- `packages/web-ui/src/utils/sqlGenerator.ts`
- `packages/web-ui/src/utils/sql.ts`

**Incorrect:**
- ~~`packages/web-ui/src/components/ui/dataGridUtils.ts`~~ (wrong location)
- ~~`packages/web-ui/src/utils/dataGridUtils.ts`~~ (wrong naming - no Utils suffix)

### Test Files
All test files must be placed in a parallel `packages/web-ui/tests/` directory that mirrors the structure of `packages/web-ui/src/`.

```
project-root/
├── src/
│   ├── utils/
│   │   ├── dataGrid.ts
│   │   ├── contextMenu.ts
│   │   └── sqlGenerator.ts
│   └── themes/
│       ├── colorUtils.ts
│       └── themeRegistry.ts
├── tests/
│   ├── setup.ts              # Test setup file
│   ├── utils/
│   │   ├── dataGrid.test.ts
│   │   ├── contextMenu.test.ts
│   │   └── sqlGenerator.test.ts
│   └── themes/
│       ├── colorUtils.test.ts
│       └── themeRegistry.test.ts
```

## Import Conventions

`@/` is an alias for `packages/web-ui/src/` (`tsconfig.app.json`, `vite.config.ts`, `packages/web-ui/vitest.config.ts`).

### In Source Files
Import from the same folder with `./`; import anything else through `@/`. Never use `../`:

```typescript
// From a component
import { formatCellValue } from "@/utils/dataGrid";

// From another util in the same folder
import { hexToRgb } from "./colorUtils";
```

### In Test Files
Always import the code under test through `@/`:

```typescript
// Correct - from packages/web-ui/tests/utils/dataGrid.test.ts
import { formatCellValue } from "@/utils/dataGrid";

// Incorrect - relative paths break when a test or a module moves
~~import { formatCellValue } from "../../src/utils/dataGrid";~~
```

Tests live only under `packages/web-ui/tests/`: Vitest does not collect `*.test.*` files placed in `packages/web-ui/src/`.

## Test File Naming

Test files must follow the pattern: `[filename].test.ts`

- `dataGrid.ts` → `dataGrid.test.ts`
- `sqlGenerator.ts` → `sqlGenerator.test.ts`

## What Belongs in `packages/web-ui/src/utils/`

Extract pure, testable logic from components into `packages/web-ui/src/utils/`:

1. **Data transformation functions** - formatters, parsers, converters
2. **Calculation functions** - positioning, sorting, filtering logic
3. **Validation functions** - input validation, sanitization
4. **SQL generators** - query builders, schema generators

### Example Extraction

**Before (in component):**
```typescript
// In DataGrid.tsx
const formatCellValue = (value: unknown): string => {
  if (value === null) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
};
```

**After (extracted):**
```typescript
// In src/utils/dataGrid.ts
export function formatCellValue(value: unknown, nullLabel = "NULL"): string {
  if (value === null || value === undefined) return nullLabel;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// In DataGrid.tsx
import { formatCellValue } from "@/utils/dataGrid";
```

## Test Organization

Organize tests using `describe` blocks that mirror the structure of the module:

```typescript
describe('dataGrid', () => {
  describe('formatCellValue', () => {
    it('should format null values', () => { ... });
    it('should format boolean values', () => { ... });
  });
  
  describe('getColumnSortState', () => {
    it('should detect ASC sort', () => { ... });
    it('should detect DESC sort', () => { ... });
  });
});
```

## Coverage Requirements

Aim for comprehensive coverage of extracted utilities:
- All exported functions must have tests
- Edge cases must be covered (null, undefined, empty strings, boundary values)
- Error conditions should be tested where applicable
- Multiple database drivers should be tested for SQL generators

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test --watch

# Run specific test file
pnpm test tests/utils/dataGrid.test.ts

# Run with coverage
pnpm test --coverage
```

## Configuration

Tests are configured in `packages/web-ui/vitest.config.ts`:
- Test files are discovered in `packages/web-ui/tests/` directory
- Setup file: `./tests/setup.ts`
- Environment: `jsdom` for DOM-related tests

### Browser storage in the test environment

`packages/web-ui/tests/setup.ts` binds `localStorage` and `sessionStorage` to the current
Vitest jsdom window before test modules load. Keep this shared setup: Node's
native storage globals can otherwise shadow jsdom, yielding unavailable or
non-browser storage. Do not work around it with per-test storage shims or a
shared `--localstorage-file`. `packages/web-ui/tests/storageEnvironment.test.ts` verifies the
real DOM storage identity, separate stores, and restoration after global stubs.

### Browser storage in the test environment

`tests/setup.ts` binds `localStorage` and `sessionStorage` to the current
Vitest jsdom window before test modules load. Keep this shared setup: Node's
native storage globals can otherwise shadow jsdom, yielding unavailable or
non-browser storage. Do not work around it with per-test storage shims or a
shared `--localstorage-file`. `tests/storageEnvironment.test.ts` verifies the
real DOM storage identity, separate stores, and restoration after global stubs.
