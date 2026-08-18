import { describe, it, expect } from "vitest";
import { promptType, PROMPT_TYPE_LABEL } from "./prompt-utils";

describe("promptType 三态归一（S6）", () => {
  it("report → report", () => {
    expect(promptType({ type: "report" })).toBe("report");
  });
  it("skill → skill", () => {
    expect(promptType({ type: "skill" })).toBe("skill");
  });
  it("snippet → snippet", () => {
    expect(promptType({ type: "snippet" })).toBe("snippet");
  });
  it("缺省/未知 → snippet（兼容旧数据）", () => {
    expect(promptType({})).toBe("snippet");
    // @ts-expect-error 故意传非法值，验证兜底
    expect(promptType({ type: "bogus" })).toBe("snippet");
  });
  it("PROMPT_TYPE_LABEL 含技能标签", () => {
    expect(PROMPT_TYPE_LABEL.skill).toBeTruthy();
  });
});
