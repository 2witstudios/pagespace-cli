import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextOnboardingStep,
  type OnboardingState,
  STEP_ORDER,
  isComplete,
  initialOnboardingState,
} from "../../src/onboarding.ts";

const base: OnboardingState = {
  step: "token",
  token: null,
  apiUrl: "https://pagespace.ai",
  drives: null,
  defaultDrive: null,
  models: null,
  defaultModel: null,
};

test("initialOnboardingState starts at the token step", () => {
  assert.equal(initialOnboardingState().step, "token");
});

test("STEP_ORDER is the full onboarding sequence", () => {
  assert.deepEqual(STEP_ORDER, ["token", "validate", "drives", "models", "default", "done"]);
});

test("nextOnboardingStep advances token→validate when a token is captured", () => {
  const out = nextOnboardingStep({ ...base, token: "mcp_abc" });
  assert.equal(out.step, "validate");
});

test("nextOnboardingStep holds at token when no token captured yet", () => {
  const out = nextOnboardingStep(base);
  assert.equal(out.step, "token", "can't advance without a token");
});

test("nextOnboardingStep advances validate→drives when token validates", () => {
  const s: OnboardingState = { ...base, token: "mcp_abc", step: "validate" };
  const out = nextOnboardingStep(s, { validated: true });
  assert.equal(out.step, "drives");
});

test("nextOnboardingStep returns to token when validation fails", () => {
  const s: OnboardingState = { ...base, token: "mcp_abc", step: "validate" };
  const out = nextOnboardingStep(s, { validated: false });
  assert.equal(out.step, "token");
  assert.equal(out.token, null, "clears the bad token");
});

test("nextOnboardingStep advances drives→models when drives discovered", () => {
  const s: OnboardingState = { ...base, token: "mcp_abc", step: "drives" };
  const out = nextOnboardingStep(s, {
    drives: [
      { slug: "a", id: "1", name: "A" },
      { slug: "b", id: "2", name: "B" },
    ],
  });
  assert.equal(out.step, "models");
  assert.deepEqual(out.defaultDrive, "a", "defaults to first drive");
});

test("nextOnboardingStep advances models→default when models discovered", () => {
  const s: OnboardingState = { ...base, token: "mcp_abc", defaultDrive: "a", step: "models" };
  const out = nextOnboardingStep(s, { models: [{ id: "m1", name: "Brain" }] });
  assert.equal(out.step, "default");
  assert.deepEqual(out.defaultModel, { id: "m1", name: "Brain" }, "defaults to first model");
});

test("nextOnboardingStep advances default→done when a default model is chosen", () => {
  const s: OnboardingState = {
    ...base,
    token: "mcp_abc",
    defaultDrive: "a",
    defaultModel: { id: "m1", name: "Brain" },
    step: "default",
  };
  const out = nextOnboardingStep(s);
  assert.equal(out.step, "done");
});

test("isComplete is true only at done", () => {
  assert.equal(isComplete(base), false);
  assert.equal(isComplete({ ...base, step: "done" }), true);
});

test("onboarding a user with a single drive + single model resolves to done in the minimal steps", () => {
  let s = initialOnboardingState();
  s = nextOnboardingStep(s, { token: "mcp_abc" });
  s = nextOnboardingStep(s, { validated: true });
  s = nextOnboardingStep(s, { drives: [{ slug: "a", id: "1", name: "A" }] });
  s = nextOnboardingStep(s, { models: [{ id: "m1", name: "Brain" }] });
  s = nextOnboardingStep(s);
  assert.equal(s.step, "done");
  assert.equal(s.defaultDrive, "a");
  assert.deepEqual(s.defaultModel, { id: "m1", name: "Brain" });
});
