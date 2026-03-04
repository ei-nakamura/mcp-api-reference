import { describe, it, expect } from "vitest";
import { GenericParser, GenericParserConfig } from "../../../src/core/generic-parser.js";

// テスト1・4用: シンプルなHTML（method + path + title）
const simpleHtml = `
<html><body>
  <h1>テストAPI</h1>
  <p>このAPIはテスト用です。</p>
  <span class="method">GET</span>
  <span class="path">/api/v1/test</span>
</body></html>
`;

// テスト2用: methodが存在しないHTML
const noMethodHtml = `
<html><body>
  <h1>概要ページ</h1>
  <span class="path">/api/v1/overview</span>
</body></html>
`;

// テスト3用: パラメータテーブルを含むHTML
const withParamsHtml = `
<html><body>
  <h1>テストAPI</h1>
  <span class="method">GET</span>
  <span class="path">/api/v1/test</span>
  <table class="params">
    <tr><th>name</th><th>type</th><th>required</th><th>description</th></tr>
    <tr><td>id</td><td>number</td><td>true</td><td>ID</td></tr>
    <tr><td>name</td><td>string</td><td>false</td><td>名前</td></tr>
  </table>
</body></html>
`;

// テスト4用: カスタムセレクタHTML
const customSelectorHtml = `
<html><body>
  <div class="api-title">カスタムタイトル</div>
  <span class="http-method">POST</span>
  <span class="api-path">/api/v2/custom</span>
</body></html>
`;

const baseConfig: GenericParserConfig = {
  name: "test-api",
  method: ".method",
  path: ".path",
};

describe("GenericParser", () => {
  it("constructor の name プロパティが設定値と一致する", () => {
    const parser = new GenericParser({ name: "my-api", method: ".m", path: ".p" });
    expect(parser.name).toBe("my-api");
  });

  describe("parseEndpoint() — シンプルなHTML", () => {
    const parser = new GenericParser(baseConfig);
    const result = parser.parseEndpoint(simpleHtml, "https://example.com/api", "test-api");

    it("1エンドポイントが抽出される", () => {
      expect(result.endpoints.length).toBe(1);
    });

    it("method が GET", () => {
      expect(result.endpoints[0].method).toBe("GET");
    });

    it("path が /api/v1/test", () => {
      expect(result.endpoints[0].path).toBe("/api/v1/test");
    });

    it("title が h1 テキスト", () => {
      expect(result.endpoints[0].title).toBe("テストAPI");
    });

    it("id が '{apiId}:{METHOD}:{path}' 形式", () => {
      expect(result.endpoints[0].id).toBe("test-api:GET:/api/v1/test");
    });
  });

  describe("parseEndpoint() — method が存在しない HTML", () => {
    const parser = new GenericParser(baseConfig);
    const result = parser.parseEndpoint(noMethodHtml, "https://example.com/overview", "test-api");

    it("endpoints: [] を返す", () => {
      expect(result.endpoints).toEqual([]);
    });
  });

  describe("parseEndpoint() — パラメータテーブルあり", () => {
    const config: GenericParserConfig = {
      ...baseConfig,
      parameters: "table.params",
      parameterNameCol: 0,
      parameterTypeCol: 1,
      parameterRequiredCol: 2,
      parameterDescCol: 3,
    };
    const parser = new GenericParser(config);
    const result = parser.parseEndpoint(withParamsHtml, "https://example.com/api", "test-api");

    it("parameters が2件抽出される", () => {
      expect(result.endpoints[0].parameters.length).toBe(2);
    });

    it("1件目のパラメータ: name=id, type=number, required=true", () => {
      const p = result.endpoints[0].parameters[0];
      expect(p.name).toBe("id");
      expect(p.type).toBe("number");
      expect(p.required).toBe(true);
    });

    it("2件目のパラメータ: name=name, required=false", () => {
      const p = result.endpoints[0].parameters[1];
      expect(p.name).toBe("name");
      expect(p.required).toBe(false);
    });
  });

  describe("parseEndpoint() — カスタムセレクタ", () => {
    const config: GenericParserConfig = {
      name: "custom-api",
      method: ".http-method",
      path: ".api-path",
      title: ".api-title",
    };
    const parser = new GenericParser(config);
    const result = parser.parseEndpoint(
      customSelectorHtml,
      "https://example.com/custom",
      "custom-api"
    );

    it("1エンドポイントが抽出される", () => {
      expect(result.endpoints.length).toBe(1);
    });

    it("カスタムセレクタでtitleが抽出される", () => {
      expect(result.endpoints[0].title).toBe("カスタムタイトル");
    });

    it("method が POST", () => {
      expect(result.endpoints[0].method).toBe("POST");
    });

    it("path が /api/v2/custom", () => {
      expect(result.endpoints[0].path).toBe("/api/v2/custom");
    });
  });
});
