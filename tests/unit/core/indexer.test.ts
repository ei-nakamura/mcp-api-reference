import { describe, it, expect, vi, beforeEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { Indexer } from "../../../src/core/indexer.js";
import { EndpointDocument } from "../../../src/types/document.js";

const mockLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const makeDoc = (id: string, apiId: string, title: string): EndpointDocument => ({
  id,
  apiId,
  category: "test",
  method: "GET" as const,
  path: "/test",
  title,
  description: "Test description",
  parameters: [],
  responseFields: [],
  examples: [],
  authentication: [],
  permissions: [],
  notes: [],
  sourceUrl: "https://example.com",
});

describe("Indexer", () => {
  let indexer: Indexer;

  beforeEach(() => {
    indexer = new Indexer(mockLogger);
  });

  it("build() does not throw", () => {
    expect(() =>
      indexer.build("testApi", [makeDoc("id1", "testApi", "Get Record")])
    ).not.toThrow();
  });

  it("search() returns hits after build() with matching docs", () => {
    indexer.build("testApi", [makeDoc("id1", "testApi", "Get Record")]);
    const results = indexer.search("Get Record");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe("id1");
  });

  it("search() returns empty array when no match", () => {
    indexer.build("testApi", [makeDoc("id1", "testApi", "Get Record")]);
    const results = indexer.search("XXXXXXXXXXXXXXX_no_match");
    expect(results).toEqual([]);
  });

  it("search() with apiId filter returns only docs from that api", () => {
    indexer.build("api1", [makeDoc("id1", "api1", "Get Record")]);
    indexer.build("api2", [makeDoc("id2", "api2", "Get Record")]);
    const results = indexer.search("Get Record", { apiId: "api2" });
    expect(results.every((r) => r.apiId === "api2")).toBe(true);
    expect(results.some((r) => r.apiId === "api1")).toBe(false);
  });

  it("search() with limit returns at most limit results", () => {
    const docs = Array.from({ length: 20 }, (_, i) =>
      makeDoc(`id${i}`, "testApi", `Get Record ${i}`)
    );
    indexer.build("testApi", docs);
    const results = indexer.search("Get Record", { limit: 5 });
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it("saveToDisk() + loadFromDisk() round-trip preserves searchability", () => {
    const tmpDir = os.tmpdir();
    const indexPath = path.join(tmpDir, `test-index-${Date.now()}.json`);

    indexer.build("testApi", [makeDoc("id1", "testApi", "Get Record")]);
    indexer.saveToDisk("testApi", indexPath);

    const indexer2 = new Indexer(mockLogger);
    indexer2.loadFromDisk("testApi", indexPath);
    const results = indexer2.search("Get Record");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe("id1");

    fs.unlinkSync(indexPath);
  });

  it("remove() removes indexed docs from the index", () => {
    indexer.build("testApi", [makeDoc("id1", "testApi", "Get Record")]);
    indexer.remove("testApi");
    const results = indexer.search("Get Record", { apiId: "testApi" });
    expect(results).toEqual([]);
  });
});
