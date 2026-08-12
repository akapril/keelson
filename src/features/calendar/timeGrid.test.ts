import { describe, it, expect } from "vitest";
import {
  snapMinutes,
  clamp,
  minuteFromY,
  dayIndexFromX,
  minutesToHM,
  addMinutesToHM,
  hmToMinutes,
  durationMin,
} from "./timeGrid";
import { HOUR_PX } from "./WeekView";

describe("clamp", () => {
  it("夹取到 [lo, hi]", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe("snapMinutes", () => {
  it("四舍五入到最近 15 分钟", () => {
    expect(snapMinutes(0)).toBe(0);
    expect(snapMinutes(7)).toBe(0); // 7 → 0（<7.5）
    expect(snapMinutes(8)).toBe(15); // 8 → 15（>=7.5）
    expect(snapMinutes(547)).toBe(540); // 547/15=36.47→36→540(09:00)
    expect(snapMinutes(552)).toBe(555); // 552/15=36.8→37→555(09:15)
    expect(snapMinutes(600)).toBe(600); // 10:00 不变
  });
  it("夹到 [0, 1440]", () => {
    expect(snapMinutes(-10)).toBe(0);
    expect(snapMinutes(9999)).toBe(24 * 60);
  });
  it("自定义步长", () => {
    expect(snapMinutes(50, 30)).toBe(60);
    expect(snapMinutes(40, 30)).toBe(30);
  });
  it("step<=0 时只四舍五入并夹取", () => {
    expect(snapMinutes(12.4, 0)).toBe(12);
    expect(snapMinutes(-1, 0)).toBe(0);
  });
});

describe("minuteFromY", () => {
  it("按 HOUR_PX 把 y 偏移换算成分钟", () => {
    // gridTop=100：clientY=100 → 0 分钟；+HOUR_PX → 60 分钟
    expect(minuteFromY(100, 100)).toBe(0);
    expect(minuteFromY(100 + HOUR_PX, 100)).toBe(60);
    expect(minuteFromY(100 + HOUR_PX / 2, 100)).toBe(30);
    // 两小时
    expect(minuteFromY(100 + HOUR_PX * 2, 100)).toBe(120);
  });
});

describe("dayIndexFromX", () => {
  it("7 等宽列：按 x 落在哪一列", () => {
    // gridLeft=0, gridWidth=700 → 每列 100px
    expect(dayIndexFromX(0, 0, 700, 7)).toBe(0);
    expect(dayIndexFromX(50, 0, 700, 7)).toBe(0);
    expect(dayIndexFromX(150, 0, 700, 7)).toBe(1);
    expect(dayIndexFromX(650, 0, 700, 7)).toBe(6);
    expect(dayIndexFromX(699, 0, 700, 7)).toBe(6);
  });
  it("超出边界夹到 [0, colCount-1]", () => {
    expect(dayIndexFromX(-100, 0, 700, 7)).toBe(0);
    expect(dayIndexFromX(9999, 0, 700, 7)).toBe(6);
  });
  it("单列（日视图）恒为 0", () => {
    expect(dayIndexFromX(123, 0, 700, 1)).toBe(0);
  });
  it("gridWidth<=0 兜底为 0", () => {
    expect(dayIndexFromX(50, 0, 0, 7)).toBe(0);
  });
});

describe("minutesToHM", () => {
  it("分钟数格式化为 HH:mm", () => {
    expect(minutesToHM(0)).toBe("00:00");
    expect(minutesToHM(555)).toBe("09:15");
    expect(minutesToHM(1439)).toBe("23:59");
  });
  it("超界夹取", () => {
    expect(minutesToHM(-5)).toBe("00:00");
    expect(minutesToHM(9999)).toBe("23:59");
  });
});

describe("hmToMinutes", () => {
  it("解析合法 HH:mm", () => {
    expect(hmToMinutes("00:00")).toBe(0);
    expect(hmToMinutes("09:15")).toBe(555);
  });
  it("非法返回 null", () => {
    expect(hmToMinutes("")).toBeNull();
    expect(hmToMinutes(undefined)).toBeNull();
    expect(hmToMinutes("24:00")).toBeNull();
  });
});

describe("addMinutesToHM", () => {
  it("在 HH:mm 上加分钟", () => {
    expect(addMinutesToHM("09:00", 60)).toBe("10:00");
    expect(addMinutesToHM("09:15", 90)).toBe("10:45");
    expect(addMinutesToHM("23:30", 60)).toBe("23:59"); // 夹到当天末
  });
  it("非法基准按 0:00 起算", () => {
    expect(addMinutesToHM("bad", 90)).toBe("01:30");
  });
});

describe("durationMin", () => {
  it("合法区间返回时长", () => {
    expect(durationMin("09:00", "10:30")).toBe(90);
  });
  it("无 end / end<=start 回退 60", () => {
    expect(durationMin("09:00", "")).toBe(60);
    expect(durationMin("09:00", "08:00")).toBe(60);
    expect(durationMin("09:00", undefined)).toBe(60);
  });
  it("无 start 回退 60", () => {
    expect(durationMin("", "10:00")).toBe(60);
  });
});
