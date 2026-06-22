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

test("nextOnboardingStep holds at validate when validated is not true (one-shot contract)", () => {
  // Validate is one-shot-and-exit-on-failure by design: the caller exits on a failed auth ping and
  // never calls the machine with validated:false. So the machine only advances on validated:true;
  // without it, it holds (a terminal condition the caller owns, not a recovery the machine owns).
  const s: OnboardingState = { ...base, token: "mcp_abc", step: "validate" };
  const out = nextOnboardingStep(s, {});
  assert.equal(out.step, "validate");
  assert.equal(out.token, "mcp_abc", "token preserved when held");
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

test("nextOnboardingStep holds at models when input.models is undefined (no discovery yet)", () => {
  const s: OnboardingState = { ...base, token: "mcp_abc", defaultDrive: "a", step: "models" };
  const out = nextOnboardingStep(s, {});
  assert.equal(out.step, "models", "should hold when models discovery hasn't happened");
});

test("nextOnboardingStep advances models→default when discovery returns empty (recoverable)", () => {
  const s: OnboardingState = { ...base, token: "mcp_abc", defaultDrive: "a", step: "models" };
  const out = nextOnboardingStep(s, { models: [] });
  assert.equal(out.step, "default", "empty discovery is recoverable — advance");
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

test("onboardingNeedsSetup uses the doctor to decide if onboarding is needed", async () => {
  const { onboardingNeedsSetup } = await import("../../src/onboarding.ts");
  // A failing doctor (no token) → onboarding needed.
  assert.equal(onboardingNeedsSetup({ hasToken: false, hasCredentials: false }), true);
  // A passing doctor (token present) → no onboarding needed.
  assert.equal(
    onboardingNeedsSetup({ hasToken: true, hasCredentials: true, apiUrl: "https://pagespace.ai" }),
    false,
  );
  // Credential store path: the launcher's loadCredentials() IIFE copies the token into env
  // before needsOnboarding() is called, so hasToken is always true when credentials are readable.
  assert.equal(onboardingNeedsSetup({ hasToken: true, hasCredentials: true }), false);
});

test("nextOnboardingStep picks the preferred drive as default when it's in the discovered set", () => {
  const s: OnboardingState = { ...base, token: "mcp_abc", step: "drives" };
  const out = nextOnboardingStep(s, {
    drives: [
      { slug: "a", id: "1", name: "A" },
      { slug: "b", id: "2", name: "B" },
    ],
    preferredDrive: "b",
  });
  assert.equal(out.defaultDrive, "b", "preferred drive wins when in the set");
});

test("nextOnboardingStep falls back to first drive when preferred is not in the discovered set", () => {
  const s: OnboardingState = { ...base, token: "mcp_abc", step: "drives" };
  const out = nextOnboardingStep(s, {
    drives: [{ slug: "a", id: "1", name: "A" }],
    preferredDrive: "nonexistent",
  });
  assert.equal(out.defaultDrive, "a", "falls back to first drive");
});

test("nextOnboardingStep without preferredDrive still defaults to first (back-compat)", () => {
  const s: OnboardingState = { ...base, token: "mcp_abc", step: "drives" };
  const out = nextOnboardingStep(s, {
    drives: [
      { slug: "a", id: "1", name: "A" },
      { slug: "b", id: "2", name: "B" },
    ],
  });
  assert.equal(out.defaultDrive, "a");
});
