import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  transaction: vi.fn(),
  llmJson: vi.fn(),
  loadOrganizerRun: vi.fn(),
  consumeRateLimit: vi.fn(),
  rateLimitIdentity: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  sql: Object.assign(mocks.sql, { transaction: mocks.transaction }),
}));
vi.mock("@/lib/llm", () => ({ llmJson: mocks.llmJson }));
vi.mock("@/lib/run/security", () => ({
  loadOrganizerRun: mocks.loadOrganizerRun,
  consumeRateLimit: mocks.consumeRateLimit,
  rateLimitIdentity: mocks.rateLimitIdentity,
}));

import { detectViolations, analyzeImpact } from "@/lib/run/impact";
import { parseChangeText } from "@/lib/run/intake";
import { applySelectedProposal, revertToPreviousVersion } from "@/lib/run/apply";
import { verifyOptions } from "@/lib/run/verify";
import { POST as intakePost } from "@/app/api/run/[eventId]/intake/route";
import type { RunPlan, RunTask } from "@/lib/run/types";

const ids = {
  setup: "00000000-0000-4000-8000-000000000001",
  caterer: "00000000-0000-4000-8000-000000000002",
  ceremony: "00000000-0000-4000-8000-000000000003",
};

function makeTask(
  id: string,
  task: string,
  startAt: string,
  durationMin: number,
  dependsOn: string[] = [],
): RunTask {
  return {
    id,
    task,
    time: startAt.slice(11, 16),
    startAt,
    durationMin,
    dependsOn,
    owner: "Team",
    status: "pending",
    icon: "clock",
  };
}

function makePlan(timeline: RunTask[]): RunPlan {
  return {
    eventType: "wedding",
    eventDate: "2026-10-10",
    guestCount: 100,
    city: "Pune",
    budgetTotal: 100000,
    theme: "Garden",
    timeline,
    budgetBreakdown: [{ category: "Venue", allocated: 100000, percentage: 100, icon: "building" }],
    vendors: [],
    checklist: [],
    constraints: { eventEndsAt: "2026-10-10T11:00:00.000Z" },
  };
}

describe("RUN impact and verification", () => {
  it("propagates a delay through all downstream dependencies", () => {
    const plan = makePlan([
      makeTask(ids.setup, "Setup", "2026-10-10T09:00:00.000Z", 30),
      makeTask(ids.caterer, "Catering", "2026-10-10T09:30:00.000Z", 30, [ids.setup]),
      makeTask(ids.ceremony, "Ceremony", "2026-10-10T10:00:00.000Z", 30, [ids.caterer]),
    ]);

    const result = analyzeImpact(plan, [{ type: "DELAY", taskId: ids.setup, minutes: 15 }]);

    expect(result.newTimes.map(({ after }) => after)).toEqual([
      "2026-10-10T09:15:00.000Z",
      "2026-10-10T09:45:00.000Z",
      "2026-10-10T10:15:00.000Z",
    ]);
    expect(result.affectedTasks).toHaveLength(3);
  });

  it("finds the critical path and slack for an independent task", () => {
    const plan = makePlan([
      makeTask(ids.caterer, "Catering", "2026-10-10T09:30:00.000Z", 30, [ids.setup]),
      makeTask(ids.ceremony, "Guest welcome", "2026-10-10T09:00:00.000Z", 15),
      makeTask(ids.setup, "Setup", "2026-10-10T09:00:00.000Z", 30),
    ]);

    const report = analyzeImpact(plan, []);

    expect(report.criticalPath).toEqual([ids.setup, ids.caterer]);
    expect(report.slackMinutes[ids.setup]).toBe(0);
    expect(report.slackMinutes[ids.caterer]).toBe(0);
    expect(report.slackMinutes[ids.ceremony]).toBe(45);
  });

  it("reports active work that depends on a cancelled task", () => {
    const plan = makePlan([
      makeTask(ids.setup, "Catering delivery", "2026-10-10T09:00:00.000Z", 30),
      makeTask(ids.caterer, "Meal service", "2026-10-10T09:30:00.000Z", 30, [ids.setup]),
    ]);

    const report = analyzeImpact(plan, [{ type: "VENDOR_CANCELLED", taskId: ids.setup }]);

    expect(report.affectedTasks.map((task) => task.id)).toEqual([ids.setup, ids.caterer]);
    expect(report.violations.some((violation) => violation.type === "dependency")).toBe(true);
  });

  it("verifies a vendor swap that restores a cancelled task", () => {
    const plan = makePlan([
      { ...makeTask(ids.setup, "Catering delivery", "2026-10-10T09:00:00.000Z", 30), vendorName: "Original Caterer" },
      makeTask(ids.caterer, "Meal service", "2026-10-10T09:30:00.000Z", 30, [ids.setup]),
    ]);
    const changes = [{ type: "VENDOR_CANCELLED" as const, taskId: ids.setup }];
    const report = analyzeImpact(plan, changes);

    const result = verifyOptions(plan, changes, report, [{
      title: "Replace caterer",
      operations: [{ type: "swap_vendor", taskId: ids.setup, vendorName: "Backup Caterer", costDelta: 0 }],
      tradeoffs: ["Uses the prepared backup vendor."],
      rupeeImpact: 0,
      source: "prepared",
    }]);

    expect(result.verified).toHaveLength(1);
    expect(result.verified[0].plan.timeline[0].status).toBe("pending");
    expect(result.verified[0].plan.timeline[0].vendorName).toBe("Backup Caterer");
  });

  it("detects venue closing and event-end constraint violations", () => {
    const plan = makePlan([
      makeTask(ids.setup, "Late setup", "2026-10-10T10:45:00.000Z", 30),
    ]);
    plan.constraints = {
      venueClosesAt: "11:00",
      eventEndsAt: "2026-10-10T11:00:00.000Z",
    };

    expect(detectViolations(plan).map((violation) => violation.type)).toEqual(["venue_close", "event_end"]);
  });

  it("rejects an option that still violates a hard event-end constraint", () => {
    const plan = makePlan([
      makeTask(ids.setup, "Setup", "2026-10-10T09:00:00.000Z", 30),
      makeTask(ids.caterer, "Catering", "2026-10-10T09:30:00.000Z", 30, [ids.setup]),
    ]);
    const change = { type: "WEATHER" as const, note: "Rain forecast" };
    const impact = analyzeImpact(plan, [change]);

    const result = verifyOptions(plan, [change], impact, [{
      title: "Delay catering",
      operations: [{ type: "shift", taskId: ids.caterer, minutes: 90 }],
      tradeoffs: ["Catering starts later."],
      rupeeImpact: 0,
      source: "generated",
    }]);

    expect(result.verified).toHaveLength(0);
    expect(result.failures.join(" ")).toContain("event end");
  });
});

describe("RUN change intake", () => {
  beforeEach(() => {
    mocks.llmJson.mockReset();
  });

  it("returns multiple validated changes from one message", async () => {
    mocks.llmJson.mockResolvedValue({
      changes: [
        { type: "DELAY", taskId: ids.caterer, minutes: 40, note: "Caterer late" },
        { type: "GUEST_COUNT", guestCount: 130, note: "30 more guests" },
      ],
      clarifyingQuestion: null,
    });

    const changes = await parseChangeText(
      "Caterer called, 40 minutes late, and 30 more guests are coming.",
      makePlan([makeTask(ids.caterer, "Catering", "2026-10-10T09:30:00.000Z", 30)]),
    );

    expect(changes.changes.map((change) => change.type)).toEqual(["DELAY", "GUEST_COUNT"]);
  });
});

describe("RUN version control", () => {
  beforeEach(() => {
    mocks.sql.mockReset();
    mocks.transaction.mockReset();
    mocks.loadOrganizerRun.mockReset();
  });

  it("returns a conflict for a stale proposal version", async () => {
    mocks.sql.mockResolvedValue([]);

    await expect(applySelectedProposal({
      run: { eventId: "event", version: 3, plan: makePlan([]) },
      eventId: "event",
      proposalId: "proposal",
      optionIndex: 0,
      expectedVersion: 2,
      idempotencyKey: "test-request-123",
      actor: "organizer",
    })).rejects.toMatchObject({ status: 409 });

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns HTTP 409 when intake submits a stale version", async () => {
    mocks.consumeRateLimit.mockResolvedValue(true);
    mocks.rateLimitIdentity.mockReturnValue("test-client");
    mocks.loadOrganizerRun.mockResolvedValue({
      eventId: "event",
      version: 3,
      plan: makePlan([]),
      answers: {},
      organizerToken: "token",
    });

    const response = await intakePost(
      new Request("https://eventmate.test/api/run/event/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 2, text: "The caterer is late" }),
      }),
      { params: { eventId: "event" } },
    );

    expect(response.status).toBe(409);
  });

  it("revert commits the previous plan as a new version", async () => {
    const previousPlan = makePlan([makeTask(ids.setup, "Restored setup", "2026-10-10T09:00:00.000Z", 30)]);
    mocks.loadOrganizerRun.mockResolvedValue({
      eventId: "event",
      version: 2,
      plan: makePlan([]),
      answers: {},
      organizerToken: "token",
    });
    mocks.sql.mockImplementation(async (strings: TemplateStringsArray) => {
      const query = strings.join("");
      if (query.includes("SELECT event_id, version, result")) return [];
      if (query.includes("SELECT plan FROM plan_versions")) return [{ plan: previousPlan }];
      return [];
    });
    mocks.transaction.mockResolvedValue([[{ version: 3, operation_nonce: "nonce" }], [], [], [], []]);

    const result = await revertToPreviousVersion({
      request: new Request("https://eventmate.test"),
      eventId: "event",
      expectedVersion: 2,
      idempotencyKey: "revert-request-123",
    });

    expect(result.version).toBe(3);
    expect(result.plan).toEqual(previousPlan);
    expect(result.idempotent).toBe(false);
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });
});
