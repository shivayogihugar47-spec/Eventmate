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
  loadOwnedOrganizerRun: mocks.loadOrganizerRun,
  consumeRateLimit: mocks.consumeRateLimit,
  rateLimitIdentity: mocks.rateLimitIdentity,
}));

import { detectViolations, analyzeImpact } from "@/lib/run/impact";
import { parseChangeText } from "@/lib/run/intake";
import { generateOptions } from "@/lib/run/options";
import { generateRisks } from "@/lib/run/risks";
import { applySelectedProposal, revertToPreviousVersion } from "@/lib/run/apply";
import { verifyOptions } from "@/lib/run/verify";
import { POST as intakePost } from "@/app/api/run/[eventId]/intake/route";
import { POST as commentPost } from "@/app/api/comment/route";
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

  it("asks for the missing duration instead of returning an invalid request for 'Caterer is hours late'", async () => {
    const result = await parseChangeText(
      "Caterer is hours late",
      makePlan([makeTask(ids.caterer, "Catering setup", "2026-10-10T09:30:00.000Z", 30)]),
    );

    expect(result).toEqual({
      changes: [],
      clarifyingQuestion: "How many minutes late is Caterer?",
    });
    expect(mocks.llmJson).not.toHaveBeenCalled();
  });

  it("returns an HTTP clarification response for an unspecified delay", async () => {
    const eventId = "00000000-0000-4000-8000-000000000099";
    mocks.consumeRateLimit.mockResolvedValue(true);
    mocks.rateLimitIdentity.mockReturnValue("test-client");
    mocks.loadOrganizerRun.mockResolvedValue({
      eventId,
      version: 1,
      plan: makePlan([makeTask(ids.caterer, "Catering setup", "2026-10-10T09:30:00.000Z", 30)]),
      answers: {},
      organizerToken: "test-token",
    });
    mocks.sql.mockResolvedValue([]);

    const response = await intakePost(
      new Request(`https://eventmate.test/api/run/${eventId}/intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1, text: "Caterer is hours late" }),
      }),
      { params: Promise.resolve({ eventId }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      clarifyingQuestion: "How many minutes late is Caterer?",
    });
    expect(mocks.llmJson).not.toHaveBeenCalled();
  });

  it("asks one clarification when the model returns invalid structured change data", async () => {
    const { z } = await import("zod");
    mocks.llmJson.mockRejectedValue(new z.ZodError([{
      code: "invalid_type",
      expected: "number",
      received: "string",
      path: ["changes", 0, "minutes"],
      message: "Expected number, received string",
    }] as never));

    const result = await parseChangeText(
      "Caterer is 1 hour late",
      makePlan([makeTask(ids.caterer, "Catering setup", "2026-10-10T09:30:00.000Z", 30)]),
    );

    expect(result.changes).toEqual([]);
    expect(result.clarifyingQuestion).toBe("I couldn't read that update clearly. Which task changed, and what is the new time or amount?");
  });

  it("uses a verified deterministic schedule fallback when AI options remain invalid", async () => {
    const { z } = await import("zod");
    const eventId = "00000000-0000-4000-8000-000000000099";
    const plan = makePlan([makeTask(ids.caterer, "Catering setup", "2026-10-10T09:30:00.000Z", 30)]);
    plan.constraints = { eventEndsAt: "2026-10-10T10:00:00.000Z" };
    mocks.consumeRateLimit.mockResolvedValue(true);
    mocks.rateLimitIdentity.mockReturnValue("test-client");
    mocks.loadOrganizerRun.mockResolvedValue({
      eventId,
      version: 1,
      plan,
      answers: {},
      organizerToken: "test-token",
    });
    mocks.sql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "00000000-0000-4000-8000-000000000100" }]);
    mocks.llmJson
      .mockResolvedValueOnce({
        changes: [{ type: "DELAY", taskId: ids.caterer, minutes: 40, note: "Caterer is late" }],
        clarifyingQuestion: null,
      })
      .mockRejectedValueOnce(new z.ZodError([{
          code: "invalid_type",
          expected: "number",
          received: "string",
          path: ["options", 0, "rupeeImpact"],
          message: "Expected number, received string",
        }] as never))
      .mockRejectedValueOnce(new z.ZodError([{
          code: "invalid_type",
          expected: "number",
          received: "string",
          path: ["options", 0, "rupeeImpact"],
          message: "Expected number, received string",
        }] as never));

    const response = await intakePost(
      new Request(`https://eventmate.test/api/run/${eventId}/intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1, text: "Caterer is 40 minutes late" }),
      }),
      { params: Promise.resolve({ eventId }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      options: [{
        source: "deterministic",
        operations: [{ type: "shift", taskId: ids.caterer, minutes: -40 }],
      }],
    });
  });
});

describe("RUN option generation", () => {
  beforeEach(() => {
    mocks.llmJson.mockReset();
  });

  it("retries schema-invalid model options with the validation details", async () => {
    const { z } = await import("zod");
    const issue = new z.ZodError([{
      code: "invalid_type",
      expected: "number",
      received: "string",
      path: ["options", 0, "rupeeImpact"],
      message: "Expected number, received string",
    }] as never);
    mocks.llmJson
      .mockRejectedValueOnce(issue)
      .mockResolvedValueOnce({
        options: [
          {
            title: "Shift the catering schedule",
            operations: [{ type: "shift", taskId: ids.caterer, minutes: -10 }],
            tradeoffs: ["Setup starts earlier."],
            rupeeImpact: 0,
          },
          {
            title: "Shorten setup time",
            operations: [{ type: "shorten", taskId: ids.caterer, minutes: 10 }],
            tradeoffs: ["The team has less preparation time."],
            rupeeImpact: 0,
          },
        ],
      });

    const plan = makePlan([makeTask(ids.caterer, "Catering setup", "2026-10-10T09:30:00.000Z", 30)]);
    const options = await generateOptions({
      plan,
      changes: [{ type: "DELAY", taskId: ids.caterer, minutes: 40 }],
      impact: analyzeImpact(plan, []),
      risks: [],
      priorities: [],
      constraints: [],
    });

    expect(options).toHaveLength(2);
    expect(options[0].source).toBe("generated");
    expect(mocks.llmJson).toHaveBeenCalledTimes(2);
    expect(mocks.llmJson.mock.calls[0][0]).toContain('"minutes":15');
    expect(mocks.llmJson.mock.calls[1][0]).toContain("options.0.rupeeImpact");
  });
});

describe("RUN risk generation fallback", () => {
  beforeEach(() => {
    mocks.llmJson.mockReset();
  });

  it("keeps plan locking available when the risk model fails", async () => {
    mocks.llmJson.mockRejectedValue(new Error("Model returned invalid contingency JSON"));
    const plan = makePlan([
      makeTask(ids.setup, "Outdoor setup", "2026-10-10T09:00:00.000Z", 30),
      makeTask(ids.caterer, "Catering", "2026-10-10T09:30:00.000Z", 30, [ids.setup]),
      makeTask(ids.ceremony, "Ceremony close", "2026-10-10T10:00:00.000Z", 30, [ids.caterer]),
    ]);
    plan.timeline[1].vendorName = "Event Caterer";
    plan.constraints = { ...plan.constraints, outdoor: true };

    const risks = await generateRisks(plan);

    expect(risks).toHaveLength(5);
    expect(risks.map((risk) => risk.triggerType)).toEqual([
      "DELAY", "VENDOR_CANCELLED", "GUEST_COUNT", "WEATHER", "VENUE_ISSUE",
    ]);
    for (const risk of risks) {
      expect(risk.status).toBe("ready");
      for (const operation of risk.backupAction) {
        if (operation.type !== "add_task") {
          expect(plan.timeline.some((task) => task.id === operation.taskId)).toBe(true);
        }
      }
    }
  });
});

describe("Comment API request validation", () => {
  beforeEach(() => {
    mocks.llmJson.mockReset();
  });

  it("accepts nullable event type and city during early planning answers", async () => {
    mocks.llmJson.mockResolvedValue({ comment: "A lovely choice for your celebration." });

    const response = await commentPost(new Request("https://eventmate.test/api/comment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: 2, answer: "2026-11-04", eventType: null, city: null }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ comment: "A lovely choice for your celebration." });
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
      { params: Promise.resolve({ eventId: "event" }) },
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
