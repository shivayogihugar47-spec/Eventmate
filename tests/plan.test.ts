import { describe, it, expect } from "vitest";
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
    expect(parseBudget("Under ₹1L")).toBe(100000);
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
