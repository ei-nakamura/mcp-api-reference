import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { BacklogParser } from "../../../../src/presets/backlog/parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "../../../fixtures/backlog");

const parser = new BacklogParser();
const getFixture = (name: string) =>
  readFileSync(path.join(fixturesDir, name), "utf-8");

describe("BacklogParser", () => {
  it("parser.name is 'backlog'", () => {
    expect(parser.name).toBe("backlog");
  });

  describe("parseEndpoint() with get-issue.html", () => {
    const html = getFixture("get-issue.html");
    const result = parser.parseEndpoint(
      html,
      "https://developer.nulab.com/ja/docs/backlog/api/2/get-issue/",
      "backlog"
    );
    const ep = result.endpoints[0];

    it("returns 1 endpoint", () => {
      expect(result.endpoints.length).toBe(1);
    });

    it("endpoint has method='GET'", () => {
      expect(ep.method).toBe("GET");
    });

    it("endpoint has path='/api/v2/issues/:issueIdOrKey'", () => {
      expect(ep.path).toBe("/api/v2/issues/:issueIdOrKey");
    });
  });

  describe("parseEndpoint() with no-endpoint.html", () => {
    const html = getFixture("no-endpoint.html");
    const result = parser.parseEndpoint(
      html,
      "https://developer.nulab.com/ja/docs/backlog/",
      "backlog"
    );

    it("returns empty endpoints array", () => {
      expect(result.endpoints).toEqual([]);
    });
  });
});
