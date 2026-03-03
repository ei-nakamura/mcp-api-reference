import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { KintoneParser } from "../../../../src/presets/kintone/parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "../../../fixtures/kintone");

const parser = new KintoneParser();
const getFixture = (name: string) =>
  readFileSync(path.join(fixturesDir, name), "utf-8");

describe("KintoneParser", () => {
  it("parser.name is 'kintone'", () => {
    expect(parser.name).toBe("kintone");
  });

  describe("parseEndpoint() with record-get.html", () => {
    const html = getFixture("record-get.html");
    const result = parser.parseEndpoint(
      html,
      "https://cybozu.dev/k/v1/record",
      "kintone"
    );
    const ep = result.endpoints[0];

    it("returns 1 endpoint", () => {
      expect(result.endpoints.length).toBe(1);
    });

    it("endpoint has method='GET'", () => {
      expect(ep.method).toBe("GET");
    });

    it("endpoint has path='/k/v1/record.json'", () => {
      expect(ep.path).toBe("/k/v1/record.json");
    });

    it("endpoint has parameters (app, id)", () => {
      const names = ep.parameters.map((p) => p.name);
      expect(names).toContain("app");
      expect(names).toContain("id");
    });

    it("endpoint has responseFields (record)", () => {
      expect(ep.responseFields.some((f) => f.name === "record")).toBe(true);
    });

    it("endpoint has authentication info", () => {
      expect(ep.authentication.length).toBeGreaterThan(0);
    });

    it("endpoint has examples (curl)", () => {
      expect(ep.examples.some((e) => e.format === "curl")).toBe(true);
    });

    it("endpoint has description text", () => {
      expect(ep.description.length).toBeGreaterThan(0);
    });
  });

  it("parseEndpoint() with no-endpoint.html returns endpoints: []", () => {
    const html = getFixture("no-endpoint.html");
    const result = parser.parseEndpoint(
      html,
      "https://cybozu.dev/k/overview",
      "kintone"
    );
    expect(result.endpoints).toEqual([]);
  });

  describe("normalizeType conversion via parseEndpoint()", () => {
    const html = getFixture("record-get.html");
    const result = parser.parseEndpoint(
      html,
      "https://cybozu.dev/k/v1/record",
      "kintone"
    );
    const ep = result.endpoints[0];

    it("数値 → number", () => {
      const appParam = ep.parameters.find((p) => p.name === "app");
      expect(appParam?.type).toBe("number");
    });

    it("文字列 → string", () => {
      const nameParam = ep.parameters.find((p) => p.name === "name");
      expect(nameParam?.type).toBe("string");
    });

    it("オブジェクト → object", () => {
      const recordField = ep.responseFields.find((f) => f.name === "record");
      expect(recordField?.type).toBe("object");
    });

    it("真偽値 → boolean", () => {
      const enabledParam = ep.parameters.find((p) => p.name === "enabled");
      expect(enabledParam?.type).toBe("boolean");
    });
  });
});
