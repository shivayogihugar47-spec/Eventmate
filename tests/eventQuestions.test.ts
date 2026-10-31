import { describe, expect, it } from "vitest";
import { buildNextEventQuestion, getEventQuestionFlow } from "../lib/eventQuestions";

describe("event question progression", () => {
  it("moves to the date after the occasion has been selected", () => {
    const result = buildNextEventQuestion([{ role: "user", content: "Corporate" }]);

    expect(result.card?.step).toBe(2);
    expect(result.card?.title).toBe("When is the big day?");
    expect(result.collectedData.eventType).toBe("corporate");
  });

  it("moves past a preselected occasion on the initial request", () => {
    const result = buildNextEventQuestion([
      { role: "user", content: "I want to plan a Corporate" },
      { role: "assistant", content: "A corporate — wonderful choice!" },
    ]);

    expect(result.card?.step).toBe(2);
    expect(result.collectedData.eventType).toBe("corporate");
  });

  it("uses a corporate track with relevant format, objective, and production questions", () => {
    const flow = getEventQuestionFlow("corporate");

    expect(flow).toHaveLength(10);
    expect(flow.map((question) => question.label)).toEqual([
      "Occasion", "Date", "Guest list", "City", "Budget", "Format", "Objective", "Duration", "Venue", "AV & production",
    ]);
    expect(flow[5].title).toBe("What kind of business event is it?");
  });

  it("uses a different wedding track focused on ceremony and guest experience", () => {
    const flow = getEventQuestionFlow("wedding");

    expect(flow).toHaveLength(10);
    expect(flow[5].title).toBe("What kind of ceremony are you planning?");
    expect(flow[9].label).toBe("Personal touches");
    expect(flow[5].key).not.toBe(getEventQuestionFlow("corporate")[5].key);
  });

  it("captures occasion-specific answers and becomes ready after the full wedding track", () => {
    const messages = ["Wedding", "2027-05-01", "50–100", "Pune", "₹3–7L", "Hindu", "Classic & elegant", "Banquet hall", "Vegetarian", "Baraat and live band"]
      .map((content) => ({ role: "user", content }));
    const result = buildNextEventQuestion(messages);

    expect(result.readyToGenerate).toBe(true);
    expect(result.card).toBeUndefined();
    expect(result.collectedData.eventDetails.ceremonyStyle).toBe("Hindu");
    expect(result.collectedData.specialRequirements).toBe("Baraat and live band");
    expect(result.collectedData.theme).toBe("Classic & elegant");
  });

  it("continues from the current answer when an API request needs its fallback", () => {
    const result = buildNextEventQuestion([
      { role: "user", content: "Birthday" },
      { role: "assistant", content: "Great choice." },
      { role: "user", content: "2027-05-01" },
    ]);

    expect(result.card?.step).toBe(3);
    expect(result.card?.title).toBe("How many people are you expecting?");
  });

  it("advances corporate users into corporate-specific questions after shared essentials", () => {
    const messages = ["Corporate", "2026-11-20", "50–100", "Belagavi", "₹3–7L"]
      .map((content) => ({ role: "user", content }));
    const result = buildNextEventQuestion(messages);

    expect(result.card?.step).toBe(6);
    expect(result.card?.title).toBe("What kind of business event is it?");
    expect(result.collectedData.eventType).toBe("corporate");
  });
});