export interface ExplainNode {
  id: string;
  node_type: string;
  relation: string | null;
  startup_cost: number | null;
  total_cost: number | null;
  plan_rows: number | null;
  actual_rows: number | null;
  actual_time_ms: number | null;
  actual_loops: number | null;
  buffers_hit: number | null;
  buffers_read: number | null;
  filter: string | null;
  index_condition: string | null;
  join_type: string | null;
  hash_condition: string | null;
  extra: Record<string, unknown>;
  children: ExplainNode[];
}

export interface ExplainPlan {
  root: ExplainNode;
  planning_time_ms: number | null;
  execution_time_ms: number | null;
  original_query: string;
  driver: string;
  has_analyze_data: boolean;
  raw_output: string | null;
}
