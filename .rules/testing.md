# Testing Conventions

This document defines the testing conventions and directory structure for the Tabularis project.

## Directory Structure

### Source Files
All utility functions and testable logic must be placed in `src/utils/` with simple, descriptive names **without the "Utils" suffix**.

**Correct:**
- `src/utils/dataGrid.ts`
- `src/utils/contextMenu.ts`
- `src/utils/sqlGenerator.ts`
- `src/utils/sql.ts`

**Incorrect:**
- ~~`src/components/ui/dataGridUtils.ts`~~ (wrong location)
- ~~`src/utils/dataGridUtils.ts`~~ (wrong naming - no Utils suffix)

### Test Files
All test files must be placed in a parallel `tests/` directory that mirrors the structure of `src/`.

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

### In Source Files
Use standard relative or absolute imports:

```typescript
// From a component
import { formatCellValue } from "../../utils/dataGrid";

// From another util
import { hexToRgb } from "./colorUtils";

// Using path alias
import { splitQueries } from "@/utils/sql";
```

### In Test Files
Always use relative imports from `tests/` to `src/`:

```typescript
// Correct - from tests/utils/dataGrid.test.ts
import { formatCellValue } from "../../src/utils/dataGrid";

// Correct - from tests/themes/colorUtils.test.ts  
import { hexToRgb } from "../../src/themes/colorUtils";

// Incorrect - relative to same directory (would fail after move)
~~import { formatCellValue } from "./dataGrid";~~
```

## Test File Naming

Test files must follow the pattern: `[filename].test.ts`

- `dataGrid.ts` → `dataGrid.test.ts`
- `sqlGenerator.ts` → `sqlGenerator.test.ts`

## What Belongs in `src/utils/`

Extract pure, testable logic from components into `src/utils/`:

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
import { formatCellValue } from "../../utils/dataGrid";
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

Tests are configured in `vitest.config.ts`:
- Test files are discovered in `tests/` directory
- Setup file: `./tests/setup.ts`
- Environment: `jsdom` for DOM-related tests

### Browser storage in the test environment

`tests/setup.ts` binds `localStorage` and `sessionStorage` to the current
Vitest jsdom window before test modules load. Keep this shared setup: Node's
native storage globals can otherwise shadow jsdom, yielding unavailable or
non-browser storage. Do not work around it with per-test storage shims or a
shared `--localstorage-file`. `tests/storageEnvironment.test.ts` verifies the
real DOM storage identity, separate stores, and restoration after global stubs.
