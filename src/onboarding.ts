/**
 * First-run onboarding flow — when no token/config exists, the launcher walks the user from a blank
 * slate to a coding-ready state instead of exiting with a "copy .mcp.json" hint.
 *
 * The flow is a pure state machine (unit-tested): token → validate → drives → models → default → done.
 * Effects (auth ping, drive/model discovery) live in the launcher and feed results back in via the
 * `input` argument. Token capture writes straight to the credential store (never .env/agent env).
 *
 * Reuses the doctor (src/doctor.ts) for the setup-needed decision — one shared diagnostic layer
 * consumed by both the launcher's `pagespace status` and the onboarding gate.
 */
import { diagnose, type DoctorInput } from "./doctor.ts";

/** A drive discovered during onboarding. */
export interface OnboardingDrive {
  id: string;
  name: string;
  slug: string;
}

/** A model (agent page) discovered during onboarding. */
export interface OnboardingModel {
  id: string;
  name: string;
}

/** The onboarding step names, in order. */
export const STEP_ORDER = ["token", "validate", "drives", "models", "default", "done"] as const;
export type OnboardingStep = (typeof STEP_ORDER)[number];

/** Mutable state threaded through the flow. */
export interface OnboardingState {
  step: OnboardingStep;
  token: string | null;
  apiUrl: string;
  drives: OnboardingDrive[] | null;
  defaultDrive: string | null;
  models: OnboardingModel[] | null;
  defaultModel: OnboardingModel | null;
}

/** The inputs an effect provides back to advance the state machine. */
export interface OnboardingInput {
  token?: string;
  validated?: boolean;
  drives?: OnboardingDrive[];
  /** The env/configured preferred drive — used to pick the default when it's in the discovered set. */
  preferredDrive?: string;
  models?: OnboardingModel[];
}

/** Fresh onboarding state, starting at the token step. Pure. */
export function initialOnboardingState(apiUrl = "https://pagespace.ai"): OnboardingState {
  return {
    step: "token",
    token: null,
    apiUrl,
    drives: null,
    defaultDrive: null,
    models: null,
    defaultModel: null,
  };
}

/** True only when the flow has reached `done`. Pure. */
export function isComplete(state: OnboardingState): boolean {
  return state.step === "done";
}

/**
 * Advance one step given the current state + any inputs from effects. Pure: decides the next step,
 * applies the input (capture token, default the drive/model to the first discovered), and never I/Os.
 * When a precondition for advancing isn't met (e.g. no token), the state is held/rewound.
 */
export function nextOnboardingStep(state: OnboardingState, input: OnboardingInput = {}): OnboardingState {
  const next: OnboardingState = { ...state };
  switch (state.step) {
    case "token": {
      const token = (input.token ?? state.token)?.trim();
      if (token) {
        next.token = token;
        next.step = "validate";
      }
      break;
    }
    case "validate": {
      // Validate is one-shot: advance to drives only on success. A failed auth ping is a terminal
      // condition the caller handles (exit) — the machine never receives validated:false, so there
      // is no recovery branch to go stale. (Onboarding is one-shot-and-exit-on-failure by design.)
      if (input.validated) next.step = "drives";
      break;
    }
    case "drives": {
      const drives = input.drives;
      if (drives && drives.length > 0) {
        next.drives = drives;
        // Default drive: the preferred/configured drive if it's in the discovered set, else the first.
        // This keeps the reported default consistent with the drive used for preferred-first ordering.
        const preferred = input.preferredDrive;
        const inSet = preferred && drives.some((d) => d.slug === preferred);
        next.defaultDrive = inSet ? preferred : drives[0].slug;
        next.step = "models";
      }
      break;
    }
    case "models": {
      const models = input.models;
      if (models && models.length > 0) {
        next.models = models;
        next.defaultModel = models[0]; // default to the first discovered model
        next.step = "default";
      } else if (models !== undefined) {
        // Explicit empty discovery is recoverable (model-discovery is optional in some setups) — go default.
        next.models = [];
        next.step = "default";
      }
      // models === undefined: hold — discovery hasn't run yet; wait for a real result.
      break;
    }
    case "default": {
      // The default has been chosen (either auto from models or explicitly); materialize.
      next.step = "done";
      break;
    }
    case "done":
      break;
  }
  return next;
}

/**
 * Decide whether first-run onboarding is needed, by running the shared doctor and checking the
 * token + credential-store checks. Pure; consumes diagnose() so the doctor is the single source of
 * "is config OK?" for both `pagespace status` and the onboarding gate. Reuse, not duplication.
 */
export function onboardingNeedsSetup(input: DoctorInput): boolean {
  const result = diagnose(input);
  const tokenOk = result.checks.find((c) => c.id === "token")?.pass ?? false;
  return !tokenOk;
}
