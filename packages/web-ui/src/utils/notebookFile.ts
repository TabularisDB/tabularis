import type {NotebookCell, NotebookFile, NotebookParam} from '@/types/notebook';
import {generateCellId} from './notebook';
import {isParamType, normalizeParam, validateParamName} from './notebookParams';
import {sanitizeKpiConfig} from './notebookKpi';

/**
 * A well-formed param from an untrusted notebook file, or null. The name must
 * be a valid identifier (`\w+`) and the value a string. An entry without a
 * `type` is a raw parameter, as every parameter was before types existed, and
 * is kept as found. A typed entry of a known type must carry booleans and
 * string options where it has them; it is stored in normalized form. Its
 * value is not validated here: a typed parameter with an invalid value is kept,
 * so the panel can show what is wrong and the cell does not run with it.
 *
 * A type named by a non-empty string this build does not know (a later build
 * may have added it) is kept as found too. Dropping the entry would leave its
 * `@name` in the SQL for the engine to read, and the next save would remove it
 * from the file; kept, it is shown as invalid and stops the cells that use it.
 */
function sanitizeParam(raw: unknown): NotebookParam | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const {name, value, type, isNull, required, options} = raw as Record<string, unknown>;
    if (typeof name !== 'string' || !validateParamName(name) || typeof value !== 'string') {
        return null;
    }
    if (type === undefined) return raw as NotebookParam;
    if (!isParamType(type)) {
        return typeof type === 'string' && type !== '' ? (raw as NotebookParam) : null;
    }
    if (isNull !== undefined && typeof isNull !== 'boolean') return null;
    if (required !== undefined && typeof required !== 'boolean') return null;
    const optionList = options ?? [];
    if (!Array.isArray(optionList) || !optionList.every((o) => typeof o === 'string')) return null;
    return normalizeParam({
        name,
        value,
        type,
        isNull: isNull === true,
        required: required === true,
        options: optionList,
    });
}

/**
 * Keep only well-formed params from an untrusted notebook file. Malformed
 * entries are dropped instead of failing the whole import.
 */
function sanitizeParams(raw: unknown): NotebookParam[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const params = raw.map(sanitizeParam).filter((p): p is NotebookParam => p !== null);
    return params.length > 0 ? params : undefined;
}

interface NotebookFileOptions {
    /** Carry local identity across save/eviction, never across import/export. */
    preserveCellIds?: boolean;
}

export function serializeNotebook(
    title: string,
    cells: NotebookCell[],
    params?: NotebookParam[],
    stopOnError?: boolean,
    connectionId?: string,
    {preserveCellIds = false}: NotebookFileOptions = {},
): NotebookFile {
    return {
        version: 2,
        title,
        createdAt: new Date().toISOString(),
        ...(connectionId ? {connectionId} : {}),
        cells: cells.map((c) => ({
            ...(preserveCellIds ? {id: c.id} : {}),
            type: c.type,
            content: c.content,
            ...(c.name ? {name: c.name} : {}),
            ...(c.schema ? {schema: c.schema} : {}),
            ...(c.chartConfig ? {chartConfig: c.chartConfig} : {}),
            ...(c.isParallel ? {isParallel: c.isParallel} : {}),
            ...(c.type === 'sql' && c.isDisabled ? {isDisabled: true} : {}),
            ...(c.isCollapsed ? {isCollapsed: c.isCollapsed} : {}),
            ...(c.isQueryCollapsed ? {isQueryCollapsed: c.isQueryCollapsed} : {}),
            ...(c.isResultCollapsed ? {isResultCollapsed: c.isResultCollapsed} : {}),
            ...(c.isChartVisible != null ? {isChartVisible: c.isChartVisible} : {}),
            ...(c.kpiConfig ? {kpiConfig: c.kpiConfig} : {}),
            ...(c.isKpiVisible != null ? {isKpiVisible: c.isKpiVisible} : {}),
            ...(c.isQueryPlanVisible != null ? {isQueryPlanVisible: c.isQueryPlanVisible} : {}),
            ...(c.includeInReport === false ? {includeInReport: false} : {}),
        })),
        ...(params && params.length > 0 ? {params} : {}),
        ...(stopOnError ? {stopOnError} : {}),
    };
}

export function validateNotebookFile(data: unknown): data is NotebookFile {
    if (typeof data !== 'object' || data === null) return false;
    const obj = data as Record<string, unknown>;
    if (typeof obj.version !== 'number') return false;
    if (typeof obj.title !== 'string') return false;
    if (!Array.isArray(obj.cells)) return false;
    return obj.cells.every(
        (cell: unknown) =>
            typeof cell === 'object' &&
            cell !== null &&
            typeof (cell as Record<string, unknown>).type === 'string' &&
            ((cell as Record<string, unknown>).type === 'sql' ||
                (cell as Record<string, unknown>).type === 'markdown') &&
            typeof (cell as Record<string, unknown>).content === 'string',
    );
}

export function deserializeNotebook(
    json: string,
    {preserveCellIds = false}: NotebookFileOptions = {},
): {
    title: string;
    cells: NotebookCell[];
    params?: NotebookParam[];
    stopOnError?: boolean;
} {
    let data: unknown;
    try {
        data = JSON.parse(json);
    } catch {
        throw new Error('Invalid JSON');
    }

    if (!validateNotebookFile(data)) {
        throw new Error('Invalid notebook file format');
    }

    const raw = data as unknown as Record<string, unknown>;
    const storedIds = new Set<string>();
    const assignedIds = new Set<string>();
    if (preserveCellIds) {
        for (const {id} of data.cells) {
            if (typeof id === 'string' && id.trim()) storedIds.add(id);
        }
    }
    return {
        title: data.title,
        cells: data.cells.map((c) => {
            const cellRaw = c as Record<string, unknown>;
            let id = c.id;
            if (typeof id !== 'string' || !storedIds.has(id) || assignedIds.has(id)) {
                do {
                    id = generateCellId();
                } while (storedIds.has(id) || assignedIds.has(id));
            }
            assignedIds.add(id);
            return {
                id,
                type: c.type,
                content: c.content,
                name: cellRaw.name as string | undefined,
                schema: c.schema,
                chartConfig: (cellRaw.chartConfig as NotebookCell['chartConfig']) ?? null,
                isParallel: cellRaw.isParallel as boolean | undefined,
                // Files written before cells could be disabled have no flag: enabled.
                isDisabled: c.type === 'sql' && cellRaw.isDisabled === true ? true : undefined,
                isCollapsed: cellRaw.isCollapsed as boolean | undefined,
                isQueryCollapsed: cellRaw.isQueryCollapsed as boolean | undefined,
                isResultCollapsed: cellRaw.isResultCollapsed as boolean | undefined,
                isChartVisible: cellRaw.isChartVisible as boolean | undefined,
                kpiConfig: sanitizeKpiConfig(cellRaw.kpiConfig),
                isKpiVisible:
                    typeof cellRaw.isKpiVisible === 'boolean' ? cellRaw.isKpiVisible : undefined,
                isQueryPlanVisible: cellRaw.isQueryPlanVisible as boolean | undefined,
                includeInReport:
                    typeof cellRaw.includeInReport === 'boolean'
                        ? cellRaw.includeInReport
                        : undefined,
                result: null,
                error: undefined,
                executionTime: null,
                isLoading: false,
                isPreview: c.type === 'markdown' ? true : undefined,
            };
        }),
        params: sanitizeParams(raw.params),
        stopOnError: typeof raw.stopOnError === 'boolean' ? raw.stopOnError : undefined,
    };
}
