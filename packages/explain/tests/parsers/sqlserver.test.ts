import { describe, expect, it } from "vitest";

import { parseSqlServerShowplanXml } from "../../src/parsers/sqlserver";

const SHOWPLAN = `<?xml version="1.0" encoding="utf-16"?>
<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan">
  <BatchSequence><Batch><Statements><StmtSimple StatementText="SELECT * FROM dbo.items">
    <QueryPlan><RelOp NodeId="0" PhysicalOp="Nested Loops" LogicalOp="Inner Join" EstimateRows="2" EstimatedTotalSubtreeCost="0.03">
      <NestedLoops>
        <OuterReferences><ColumnReference Table="[items]" Column="[id]" /></OuterReferences>
        <RelOp NodeId="1" PhysicalOp="Index Seek" LogicalOp="Index Seek" EstimateRows="1" EstimatedTotalSubtreeCost="0.01">
          <IndexScan><Object Schema="[dbo]" Table="[items]" Index="[pk_items]" /></IndexScan>
        </RelOp>
        <RelOp NodeId="2" PhysicalOp="Table Scan" LogicalOp="Table Scan" EstimateRows="2" EstimatedTotalSubtreeCost="0.02">
          <TableScan><Object Schema="[dbo]" Table="[details]" /></TableScan>
        </RelOp>
      </NestedLoops>
    </RelOp></QueryPlan>
  </StmtSimple></Statements></Batch></BatchSequence>
</ShowPlanXML>`;

describe("parseSqlServerShowplanXml", () => {
  it("maps operators, estimates, relations, and hierarchy", () => {
    const plan = parseSqlServerShowplanXml(SHOWPLAN);
    expect(plan.driver).toBe("sqlserver");
    expect(plan.root.node_type).toBe("Nested Loops");
    expect(plan.root.join_type).toBe("Inner Join");
    expect(plan.root.relation).toBeNull();
    expect(plan.root.plan_rows).toBe(2);
    expect(plan.root.children).toHaveLength(2);
    expect(plan.root.children[0]?.relation).toBe("items");
    expect(plan.root.children[1]?.node_type).toBe("Table Scan");
    expect(plan.has_analyze_data).toBe(false);
  });

  it("rejects XML without an execution operator", () => {
    expect(() => parseSqlServerShowplanXml("<ShowPlanXML />")).toThrow("RelOp");
  });
});
