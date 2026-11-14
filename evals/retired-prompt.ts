// The explanation system prompt as it stood before Phase 10 settled it, kept
// here so the shipped one has something to be measured against. It lives with
// the evals: the app never ships a prompt it doesn't use.
//
// Not recovered from history (Phase 10 landed as one commit) but the draft the
// Phase 10 spec argued against: formatting forbidden outright rather than a
// small permitted subset, and no instruction to name only the paths given.

export const RETIRED_EXPLAIN_SYSTEM = [
  "You explain a codebase to a developer reading it for the first time.",
  "Explain what you're shown in plain prose, two or three short paragraphs. Do not use any markdown formatting.",
].join("\n");
