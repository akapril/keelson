// spotlight store 纯逻辑测试：类别循环
import { describe, it, expect } from "vitest";
import { nextCategory, CATEGORIES } from "../spotlight";

describe("nextCategory", () => {
  it("CATEGORIES 顺序固定为 全部→会话→项目→文档→任务→记忆", () => {
    expect(CATEGORIES).toEqual(["all", "session", "project", "doc", "task", "memory"]);
  });
  it("next 向后循环，末尾回到开头", () => {
    expect(nextCategory("all", "next")).toBe("session");
    expect(nextCategory("memory", "next")).toBe("all");
  });
  it("prev 向前循环，开头回到末尾", () => {
    expect(nextCategory("all", "prev")).toBe("memory");
    expect(nextCategory("session", "prev")).toBe("all");
  });
});
