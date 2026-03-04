import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { describe, it, expect, afterEach, vi } from "vitest";
import { loadCustomSitesForTest, loadConfigsForTest } from "../../../src/server.js";
import { Logger } from "../../../src/utils/logger.js";
import { createRegistryWithPresets } from "../../../src/presets/index.js";
import { GenericParser } from "../../../src/core/generic-parser.js";

const mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

const tmpFiles: string[] = [];
const writeTmp = (content: object) => {
  const f = path.join(os.tmpdir(), `test-config-${Date.now()}.json`);
  fs.writeFileSync(f, JSON.stringify(content));
  tmpFiles.push(f);
  return f;
};
afterEach(() => tmpFiles.forEach(f => fs.existsSync(f) && fs.unlinkSync(f)));

const validSite = {
  id: "test-site",
  name: "Test Site",
  baseUrl: "https://example.com",
  crawl: { startUrl: "https://example.com/docs/" },
  parser: { type: "preset" },
};

describe("loadCustomSitesForTest", () => {
  it("有効なJSONカスタム設定を読み込める（sites配列あり）", () => {
    const f = writeTmp({ sites: [validSite] });
    const result = loadCustomSitesForTest(f, mockLogger);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("test-site");
    expect(result[0].name).toBe("Test Site");
  });

  it("存在しないファイルパスは空配列を返す", () => {
    const result = loadCustomSitesForTest("/nonexistent/path/config.json", mockLogger);
    expect(result).toEqual([]);
  });

  it("不正なJSON（構文エラー）は空配列を返す", () => {
    const f = path.join(os.tmpdir(), `test-invalid-${Date.now()}.json`);
    fs.writeFileSync(f, "{ invalid json !!!}");
    tmpFiles.push(f);
    const result = loadCustomSitesForTest(f, mockLogger);
    expect(result).toEqual([]);
  });

  it("sitesフィールドがない場合は空配列を返す", () => {
    const f = writeTmp({ other: "data" });
    const result = loadCustomSitesForTest(f, mockLogger);
    expect(result).toEqual([]);
  });

  it("Zodバリデーション失敗（不正なURLなど）は空配列を返す", () => {
    const f = writeTmp({
      sites: [{
        id: "bad-site",
        name: "Bad Site",
        baseUrl: "not-a-valid-url",
        crawl: { startUrl: "also-not-a-url" },
        parser: { type: "preset" },
      }],
    });
    const result = loadCustomSitesForTest(f, mockLogger);
    expect(result).toEqual([]);
  });
});

describe("GenericParser統合テスト", () => {
  it("type=genericのカスタム設定がparserRegistryに登録される", () => {
    const genericSite = {
      id: "test-generic",
      name: "Test Generic",
      baseUrl: "https://example.com",
      crawl: { startUrl: "https://example.com/docs/" },
      parser: {
        type: "generic",
        selectors: {
          endpointContainer: ".endpoint",
          method: ".method",
          path: ".path",
        },
      },
    };
    const f = writeTmp({ sites: [genericSite] });
    const registry = createRegistryWithPresets(mockLogger);
    const configs = loadConfigsForTest({ configPath: f }, registry, mockLogger);

    const parser = registry.getParser("test-generic");
    expect(parser).toBeInstanceOf(GenericParser);
    expect(configs.some(c => c.id === "test-generic")).toBe(true);
  });
});

describe("プリセット設定マージテスト", () => {
  it("プリセットのみの場合、kintoneとbacklogの両方がconfigsに含まれる", () => {
    const registry = createRegistryWithPresets(mockLogger);
    const configs = loadConfigsForTest({}, registry, mockLogger);
    const ids = configs.map(c => c.id);
    expect(ids).toContain("kintone");
    expect(ids).toContain("backlog");
  });

  it("カスタム設定がプリセットと同じIDを持つ場合、カスタム設定で上書きされる", () => {
    const customKintone = {
      id: "kintone",
      name: "Custom Kintone Override",
      baseUrl: "https://example.com",
      crawl: { startUrl: "https://example.com/docs/" },
      parser: { type: "preset" },
    };
    const f = writeTmp({ sites: [customKintone] });
    const registry = createRegistryWithPresets(mockLogger);
    const configs = loadConfigsForTest({ configPath: f }, registry, mockLogger);

    const kintone = configs.find(c => c.id === "kintone");
    expect(kintone).toBeDefined();
    expect(kintone!.name).toBe("Custom Kintone Override");
  });
});
