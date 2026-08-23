// Shared soft-rate-limit label text for Project review's optional local-model
// calls -- one copy of the wording, matching llmStatus.js's COLD_START_HINT.

import { DEFAULT_LIMIT, ollamaCooldownSeconds, ollamaRequestsRemaining } from '../llm/rateLimit.js';

/** `{ text, atLimit }` for the current rolling-hour window, given a request limit. */
export function rateLimitLabel(limit = DEFAULT_LIMIT) {
  const remaining = ollamaRequestsRemaining(limit);
  if (remaining > 0) {
    return { text: `${remaining} of ${limit} requests left this hour`, atLimit: false };
  }
  const cooldown = ollamaCooldownSeconds(limit);
  const minutes = Math.max(1, Math.ceil(cooldown / 60));
  return { text: `Hourly limit reached -- try again in about ${minutes} min`, atLimit: true };
}
