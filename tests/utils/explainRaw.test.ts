import { describe, expect, it, vi } from "vitest";
import {
  detectRawExplainLanguage,
  formatRawExplainOutput,
  formatXml,
  getRawExplainExtension,
  getRawExplainFileOptions,
  saveRawExplainOutput,
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

  describe("getRawExplainExtension", () => {
    it("maps json to json", () => {
      expect(getRawExplainExtension("json")).toBe("json");
    });

    it("maps xml to xml", () => {
      expect(getRawExplainExtension("xml")).toBe("xml");
    });

    it("maps plaintext to txt", () => {
      expect(getRawExplainExtension("plaintext")).toBe("txt");
    });
  });

  describe("getRawExplainFileOptions", () => {
    it("returns json options for json payload", () => {
      const options = getRawExplainFileOptions('{"plan":{}}');
      expect(options.defaultPath).toBe("explain.json");
      expect(options.filters).toEqual([
        { name: "JSON", extensions: ["json"] },
        { name: "All files", extensions: ["*"] },
      ]);
    });

    it("returns xml options for xml payload", () => {
      const options = getRawExplainFileOptions("<ShowPlanXML/>");
      expect(options.defaultPath).toBe("explain.xml");
      expect(options.filters).toEqual([
        { name: "XML", extensions: ["xml"] },
        { name: "All files", extensions: ["*"] },
      ]);
    });

    it("returns txt options for plaintext payload", () => {
      const options = getRawExplainFileOptions("Seq Scan on users");
      expect(options.defaultPath).toBe("explain.txt");
      expect(options.filters).toEqual([
        { name: "Text", extensions: ["txt"] },
        { name: "All files", extensions: ["*"] },
      ]);
    });
  });

  describe("saveRawExplainOutput", () => {
    it("writes original content without modification to the chosen file path", async () => {
      const saveDialog = vi.fn().mockResolvedValue("/tmp/saved_explain.json");
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const raw = '{"query_block": {"cost": 10.5}}';

      const result = await saveRawExplainOutput(raw, { saveDialog, writeFile });

      expect(result).toBe(true);
      expect(saveDialog).toHaveBeenCalledWith({
        defaultPath: "explain.json",
        filters: [
          { name: "JSON", extensions: ["json"] },
          { name: "All files", extensions: ["*"] },
        ],
      });
      // Content must match the original raw string exactly, not reformatted
      expect(writeFile).toHaveBeenCalledWith("/tmp/saved_explain.json", raw);
    });

    it("preserves unformatted single-line XML when saving", async () => {
      const saveDialog = vi.fn().mockResolvedValue("/tmp/plan.xml");
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const singleLineXml = "<ShowPlanXML><BatchSequence/></ShowPlanXML>";

      const result = await saveRawExplainOutput(singleLineXml, { saveDialog, writeFile });

      expect(result).toBe(true);
      expect(writeFile).toHaveBeenCalledWith("/tmp/plan.xml", singleLineXml);
    });

    it("returns false and does not write when user cancels dialog", async () => {
      const saveDialog = vi.fn().mockResolvedValue(null);
      const writeFile = vi.fn();

      const result = await saveRawExplainOutput('{"test": true}', { saveDialog, writeFile });

      expect(result).toBe(false);
      expect(saveDialog).toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
    });

    it("propagates dialog rejection", async () => {
      const saveDialog = vi.fn().mockRejectedValue(new Error("dialog cancelled by OS"));
      const writeFile = vi.fn();

      await expect(
        saveRawExplainOutput("raw content", { saveDialog, writeFile }),
      ).rejects.toThrow("dialog cancelled by OS");

      expect(writeFile).not.toHaveBeenCalled();
    });

    it("propagates file write rejection", async () => {
      const saveDialog = vi.fn().mockResolvedValue("/read-only/path.txt");
      const writeFile = vi.fn().mockRejectedValue(new Error("permission denied"));

      await expect(
        saveRawExplainOutput("raw content", { saveDialog, writeFile }),
      ).rejects.toThrow("permission denied");
    });
  });
});
