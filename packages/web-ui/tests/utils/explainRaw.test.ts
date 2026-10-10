import { describe, expect, it } from "vitest";
import {
  detectRawExplainLanguage,
  formatRawExplainOutput,
  formatXml,
} from "../../src/utils/explainRaw";

describe("explainRaw", () => {
  describe("detectRawExplainLanguage", () => {
    it("detects JSON documents and arrays", () => {
      expect(detectRawExplainLanguage('{"query_block": {}}')).toBe("json");
      expect(detectRawExplainLanguage('  [{"Plan": {}}]')).toBe("json");
    });

    it("detects XML from a leading tag or declaration", () => {
      expect(detectRawExplainLanguage("<ShowPlanXML/>")).toBe("xml");
      expect(detectRawExplainLanguage('\n<?xml version="1.0"?><a/>')).toBe("xml");
    });

    it("falls back to plaintext", () => {
      expect(detectRawExplainLanguage("Seq Scan on users (cost=0.00..1.00)")).toBe("plaintext");
      expect(detectRawExplainLanguage("")).toBe("plaintext");
    });
  });

  describe("formatXml", () => {
    it("indents nested elements one per line", () => {
      expect(formatXml("<a><b><c/></b></a>")).toBe(
        ["<a>", "  <b>", "    <c/>", "  </b>", "</a>"].join("\n"),
      );
    });

    it("keeps leaf text on the same line as its tags", () => {
      expect(formatXml("<a><name>users</name><empty></empty></a>")).toBe(
        ["<a>", "  <name>users</name>", "  <empty>", "  </empty>", "</a>"].join("\n"),
      );
    });

    it("does not split on '>' inside quoted attribute values", () => {
      const xml =
        '<RelOp NodeId="0"><ScalarOperator ScalarString="[o].[total]>(0) AND [c].[id]<(10)"/></RelOp>';
      expect(formatXml(xml)).toBe(
        [
          '<RelOp NodeId="0">',
          '  <ScalarOperator ScalarString="[o].[total]>(0) AND [c].[id]<(10)"/>',
          "</RelOp>",
        ].join("\n"),
      );
    });

    it("keeps declarations, comments and CDATA as single lines", () => {
      const xml =
        '<?xml version="1.0"?><!-- plan --><a><![CDATA[SELECT 1 > 0]]></a>';
      expect(formatXml(xml)).toBe(
        [
          '<?xml version="1.0"?>',
          "<!-- plan -->",
          "<a>",
          "  <![CDATA[SELECT 1 > 0]]>",
          "</a>",
        ].join("\n"),
      );
    });

    it("never indents below zero on unbalanced input", () => {
      expect(formatXml("</a><b/>")).toBe("</a>\n<b/>");
    });
  });

  describe("formatRawExplainOutput", () => {
    it("indents a single-line SHOWPLAN document", () => {
      const showplan =
        '<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.564"><BatchSequence><Batch><Statements><StmtSimple StatementText="SELECT 1"><QueryPlan><RelOp NodeId="0" PhysicalOp="Compute Scalar"/></QueryPlan></StmtSimple></Statements></Batch></BatchSequence></ShowPlanXML>';
      const formatted = formatRawExplainOutput(showplan);
      const lines = formatted.split("\n");

      expect(lines).toHaveLength(13);
      expect(lines[0]).toBe(
        '<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.564">',
      );
      expect(lines[6]).toBe(
        '            <RelOp NodeId="0" PhysicalOp="Compute Scalar"/>',
      );
      expect(lines[12]).toBe("</ShowPlanXML>");
    });

    it("leaves XML that already spans several lines untouched", () => {
      const pretty = "<a>\n  <b/>\n</a>";
      expect(formatRawExplainOutput(pretty)).toBe(pretty);
    });

    it("returns JSON and text unchanged", () => {
      const json = '{"query_block":{"select_id":1}}';
      const text = "Seq Scan on users  (cost=0.00..1.00 rows=1 width=4)";
      expect(formatRawExplainOutput(json)).toBe(json);
      expect(formatRawExplainOutput(text)).toBe(text);
    });
  });
});
