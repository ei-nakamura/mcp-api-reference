import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { SmartHRParser } from "../../../../src/presets/smarthr/parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "../../../fixtures/smarthr");

const parser = new SmartHRParser();
const getFixture = (name: string) =>
  readFileSync(path.join(fixturesDir, name), "utf-8");

describe("SmartHRParser", () => {
  it("parser.name is 'smarthr'", () => {
    expect(parser.name).toBe("smarthr");
  });

  describe("parseEndpoint() with list-crews.html (Redoc operation sections)", () => {
    const html = getFixture("list-crews.html");
    const result = parser.parseEndpoint(
      html,
      "https://developer.smarthr.jp/api/",
      "smarthr"
    );

    it("returns 2 endpoints from single page", () => {
      expect(result.endpoints.length).toBe(2);
    });

    describe("first endpoint (GET /api/v1/crews)", () => {
      const ep = result.endpoints[0];

      it("has method='GET'", () => {
        expect(ep.method).toBe("GET");
      });

      it("has path='/api/v1/crews'", () => {
        expect(ep.path).toBe("/api/v1/crews");
      });

      it("has title", () => {
        expect(ep.title).toBe("従業員の一覧");
      });

      it("has parameters (page, per_page, emp_status)", () => {
        const names = ep.parameters.map((p) => p.name);
        expect(names).toContain("page");
        expect(names).toContain("per_page");
        expect(names).toContain("emp_status");
      });

      it("has responseFields (id, last_name, first_name)", () => {
        const names = ep.responseFields.map((f) => f.name);
        expect(names).toContain("id");
        expect(names).toContain("last_name");
        expect(names).toContain("first_name");
      });

      it("has sourceUrl with fragment", () => {
        expect(ep.sourceUrl).toBe(
          "https://developer.smarthr.jp/api/#operation/listCrews"
        );
      });
    });

    describe("second endpoint (POST /api/v1/crews)", () => {
      const ep = result.endpoints[1];

      it("has method='POST'", () => {
        expect(ep.method).toBe("POST");
      });

      it("has path='/api/v1/crews'", () => {
        expect(ep.path).toBe("/api/v1/crews");
      });

      it("has required parameters", () => {
        const lastNameParam = ep.parameters.find((p) => p.name === "last_name");
        expect(lastNameParam?.required).toBe(true);
      });
    });
  });

  describe("parseEndpoint() with no-endpoint.html", () => {
    const html = getFixture("no-endpoint.html");
    const result = parser.parseEndpoint(
      html,
      "https://developer.smarthr.jp/api/about_api",
      "smarthr"
    );

    it("returns empty endpoints array", () => {
      expect(result.endpoints).toEqual([]);
    });
  });

  describe("parseEndpoint() with alt-pattern.html (alternative pattern)", () => {
    const html = getFixture("alt-pattern.html");
    const result = parser.parseEndpoint(
      html,
      "https://developer.smarthr.jp/api/",
      "smarthr"
    );

    it("returns 1 endpoint via alternative pattern", () => {
      expect(result.endpoints.length).toBe(1);
    });

    it("has method='GET' and path='/api/v1/departments'", () => {
      const ep = result.endpoints[0];
      expect(ep.method).toBe("GET");
      expect(ep.path).toBe("/api/v1/departments");
    });

    it("has title from heading", () => {
      const ep = result.endpoints[0];
      expect(ep.title).toBe("部署の一覧");
    });
  });
});
