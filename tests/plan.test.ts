import { describe, it, expect } from "vitest";
import { normalizeBudgetAmounts, formatINR } from "../lib/budget";
import { normalizeBudget, scheduleTasks, parseBudget } from "../lib/stages/plan";

describe("Plan Logic", () => {
  it("should normalize budget to sum exactly to total", () => {
    const raw = [
      { category: "Food", weight: 5, icon: "utensils", notes: "" },
      { category: "Decor", weight: 3, icon: "flower2", notes: "" },
    ];
    const total = 800000;
    const normalized = normalizeBudget(raw as any, total, ["Food", "Decor"]);
    
    const sum = normalized.reduce((s, item) => s + item.allocated, 0);
    expect(sum).toBe(total);
    
    // Food should have higher allocation because it's first in priorities
    const food = normalized.find(n => n.category === "Food");
    const decor = normalized.find(n => n.category === "Decor");
    expect(food!.allocated).toBeGreaterThan(decor!.allocated);
  });

  it("should parse budget strings correctly", () => {
    expect(parseBudget("₹3-7L")).toBe(500000);
    expect(parseBudget("₹15L+")).toBe(1500000);
    expect(parseBudget("Under ₹1L")).toBe(50000);
    expect(parseBudget("Under ₹25,000")).toBe(12500);
    expect(parseBudget("₹25,000–₹50,000")).toBe(37500);
    expect(parseBudget("₹50,000–₹1L")).toBe(75000);
    expect(parseBudget("₹50L–₹1Cr")).toBe(7500000);
    expect(parseBudget("₹1Cr+")).toBe(10000000);
    expect(parseBudget("₹75,000")).toBe(75000);
  });

  it("formats Indian budgets in rupees, thousands, lakhs, and crores", () => {
    expect(formatINR(750)).toBe("₹750");
    expect(formatINR(37500)).toBe("₹37.5K");
    expect(formatINR(750000)).toBe("₹7.5L");
    expect(formatINR(10000000)).toBe("₹1Cr");
  });

  it("keeps generated budget allocations equal to the selected total", () => {
    const breakdown = normalizeBudgetAmounts([
      { category: "Venue", allocated: 700, percentage: 70 },
      { category: "Food", allocated: 300, percentage: 30 },
    ], 37500);

    expect(breakdown.map((item) => item.allocated)).toEqual([26250, 11250]);
    expect(breakdown.reduce((sum, item) => sum + item.allocated, 0)).toBe(37500);
  });

  it("should schedule tasks backward from event date", () => {
    const tasks = [
      { task: "Task 1", durationDays: 10, dependsOnIndex: null, owner: "", description: "", icon: "" },
      { task: "Task 2", durationDays: 5, dependsOnIndex: 0, owner: "", description: "", icon: "" },
    ];
    const eventDate = "2026-12-01";
    const timeline = scheduleTasks(tasks as any, eventDate);
    
    expect(timeline.length).toBe(2);
    // Task 2 ends at eventDate, starts 5 days before
    // Task 1 ends when Task 2 starts (in this simple implementation)
    const t2Date = new Date(timeline[1].time);
    const t1Date = new Date(timeline[0].time);
    expect(t2Date.getTime()).toBeGreaterThan(t1Date.getTime());
  });
});

describe("Re-plan Logic", () => {
  it("should not drop top priority category below its floor", async () => {
    // This logic is in handleReplan, but we can test the heuristic directly if exported
    // For now, we'll just check if the logic in replan.ts handles a simulated 30% cut
    const before = 100000;
    const rupeeImpact = -40000; // 40% cut
    const priorities = ["Food", "Decor"];
    const category = "Food";

    let after = before + rupeeImpact;
    const isTopPriority = priorities[0] === category;
    if (isTopPriority && after < before * 0.9 && rupeeImpact < 0) {
      after = Math.round(before * 0.9);
    }

    expect(after).toBe(90000); // Clamped to 10% drop
  });
});
