export interface QueryHistoryEntry {
    id: string;
    sql: string;
    executedAt: string;
    executionTimeMs: number | null;
    status: 'success' | 'error';
    rowsAffected: number | null;
    error: string | null;
    database: string | null;
}

export interface QueryHistoryResponse {
    entries: QueryHistoryEntry[];
    recoveredBackupPath: string | null;
}

export interface QueryHistoryRecoveryNotice {
    connectionId: string;
    backupPath: string;
}

export type QueryHistoryInsightsWindowPreset = 'last24Hours' | 'last7Days' | 'last30Days';

export type QueryHistoryRegressionStatus =
    'regressed' | 'improved' | 'stable' | 'insufficientSamples';

export interface QueryHistoryInsightsRequest {
    connectionId: string;
    database?: string | null;
    windowHours?: number;
    dialect?: string | null;
    now?: string | null;
    maxGroups?: number;
    maxExecutionsPerGroup?: number;
}

export interface QueryHistoryInsightsPolicy {
    minRegressionSamples: number;
    minRegressionDeltaMs: number;
    minRegressionRatio: number;
    timingSource: 'client-observed' | string;
}

export interface QueryHistoryInsightsCoverage {
    currentWindowStart: string;
    currentWindowEnd: string;
    priorWindowStart: string;
    priorWindowEnd: string;
    totalStoredExecutions: number;
    maxStoredExecutions: number;
    retentionCapReached: boolean;
    oldestRecordedAt: string | null;
    priorWindowFullyCovered: boolean;
    currentWindowExecutions: number;
    currentWindowMissingDurationCount: number;
    priorWindowExecutions: number;
    priorWindowMissingDurationCount: number;
}

export interface QueryHistoryShapeInsight {
    fingerprint: string;
    exampleSql: string;
    statementKind: string;
    databases: string[];
    hasUnrecordedDatabase: boolean;
    lastExecutedAt: string;
    callCount: number;
    timedSampleCount: number;
    missingDurationCount: number;
    totalDurationMs: number;
    avgDurationMs: number | null;
    maxDurationMs: number | null;
    failureCount: number;
    failureRate: number;
    priorCallCount: number;
    priorTimedSampleCount: number;
    priorMissingDurationCount: number;
    priorTotalDurationMs: number;
    priorAvgDurationMs: number | null;
    priorFailureCount: number;
    priorFailureRate: number;
    deltaAvgMs: number | null;
    relativeDeltaAvg: number | null;
    isRegressed: boolean;
    regressionStatus: QueryHistoryRegressionStatus;
    contributingExecutions: QueryHistoryEntry[];
}

export interface QueryHistoryInsightsResponse {
    groups: QueryHistoryShapeInsight[];
    coverage: QueryHistoryInsightsCoverage;
    policy: QueryHistoryInsightsPolicy;
}
