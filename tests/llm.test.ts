import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class OpenAI {
    chat = { completions: { create: mocks.create } };
  },
}));

import { llmJson } from "@/lib/llm";

describe("llmJson", () => {
  beforeEach(() => {
    mocks.create.mockReset();
  });

  it("does not retry the fallback model when the provider reports insufficient credits", async () => {
    const creditError = Object.assign(new Error("Insufficient credits"), { status: 402 });
    mocks.create.mockRejectedValue(creditError);

    await expect(llmJson(
      "Test prompt",
      [{ role: "user", content: "Unique credit test" }],
      z.object({ ok: z.boolean() }),
    )).rejects.toBe(creditError);

    expect(mocks.create).toHaveBeenCalledOnce();
  });
});
