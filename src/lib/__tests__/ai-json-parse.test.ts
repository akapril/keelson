import { describe, it, expect } from "vitest";
import { parseJsonReply, asString, asRecord } from "../ai-json-parse";

describe("parseJsonReply", () => {
  it("解析裸 JSON 对象", () => {
    expect(parseJsonReply('{"a":1}')).toEqual({ a: 1 });
  });

  it("去掉 ```json 围栏", () => {
    const reply = '```json\n{"a":1,"b":"x"}\n```';
    expect(parseJsonReply(reply)).toEqual({ a: 1, b: "x" });
  });

  it("去掉无语言标记的 ``` 围栏", () => {
    expect(parseJsonReply('```\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it("截取前后夹带解释文字里的 JSON", () => {
    const reply = '好的，结果如下：{"tasks":[]} 以上。';
    expect(parseJsonReply(reply)).toEqual({ tasks: [] });
  });

  it("非法 JSON 返回 null", () => {
    expect(parseJsonReply("不是 json")).toBeNull();
    expect(parseJsonReply('{"a":')).toBeNull();
    expect(parseJsonReply("")).toBeNull();
  });
});

describe("asString / asRecord", () => {
  it("asString 只认字符串", () => {
    expect(asString("x")).toBe("x");
    expect(asString(1)).toBeUndefined();
    expect(asString(null)).toBeUndefined();
  });

  it("asRecord 只认普通对象", () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord([1, 2])).toBeNull();
    expect(asRecord(null)).toBeNull();
    expect(asRecord("x")).toBeNull();
  });
});
