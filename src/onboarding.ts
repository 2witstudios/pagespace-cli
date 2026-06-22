/**
 * First-run onboarding flow — when no token/config exists, the launcher walks the user from a blank
 * slate to a coding-ready state instead of exiting with a "copy .mcp.json" hint.
 *
 * The flow is a pure state machine (unit-tested): token → validate → drives → models → default → done.
 * Effects (auth ping, drive/model discovery) live in the launcher and feed results back in via the
 * `input` argument. Token capture writes straight to the credential store (never .env/agent env).
 */

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
      if (input.validated) {
        next.step = "drives";
      } else {
        next.step = "token";
        next.token = null; // clear the rejected token
      }
      break;
    }
    case "drives": {
      const drives = input.drives;
      if (drives && drives.length > 0) {
        next.drives = drives;
        next.defaultDrive = drives[0].slug; // default to the first (preferred) drive
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
      } else {
        // No models found is recoverable (model-discovery is optional in some setups) — go done.
        next.models = [];
        next.step = "default";
      }
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
