// Prefilled link-outs for the chat-LLM round trip: a degenerate,
// human-in-the-loop "provider" -- open a hosted chat site with the copy-out
// prompt (engine/render/llmdraftprompt.js) already in its composer, instead
// of the user pasting it in by hand. Lives in llm/ rather than engine/
// because that is what this directory already is: not the prompt content,
// but how the app reaches a model.
//
// ONLY two targets, and this must stay a short, deliberately-curated list
// rather than growing every time another chat product ships one. ChatGPT
// and Claude both have a documented, stable `?q=` param that auto-populates
// the composer. Gemini has no documented prefill param as of writing.
// Perplexity's `?q=` runs a SEARCH, not a composer prefill -- wrong shape
// for a task that needs the model to follow an output contract, so it is
// deliberately excluded even though the param exists.
//
// THESE ARE UNVERIFIED, UNVERSIONED THIRD-PARTY URL CONTRACTS. Any of them
// can change or vanish without notice; that is exactly why buildChatUrl
// below always degrades to "open the site with nothing prefilled" rather
// than failing, and why describe.js's caller must ALWAYS copy the prompt to
// the clipboard before opening any of these -- the prefill is a bonus, the
// clipboard is the contract.
//
// Leaf module: imports nothing. No DOM here, so this stays importable
// (and testable) from plain Node -- window.open belongs to the UI call site.

export const CHAT_TARGETS = [
  { id: 'chatgpt', label: 'Open in ChatGPT', origin: 'https://chatgpt.com/', param: 'q' },
  { id: 'claude', label: 'Open in Claude', origin: 'https://claude.ai/new', param: 'q' },
];

// A conservative cross-browser ceiling for a full URL's length. Chosen as a
// budget for the ENCODED url (see buildChatUrl below), not the raw prompt --
// most browsers/servers tolerate more, but staying well under keeps this
// robust rather than tuned to one implementation's exact limit.
export const MAX_PREFILL_URL_CHARS = 2000;

/**
 * Build the URL to open for `target`, prefilling `prompt` if it fits.
 *
 * The length check is against the FULLY ENCODED url, not the raw prompt
 * length -- encodeURIComponent inflates prompt text roughly 1.5-2x (every
 * newline becomes %0A, every quote %22, every space %20), so a prompt that
 * looks well within budget as raw text routinely is not once encoded. This
 * is deliberate, not a bug to "fix" by loosening the check: the point is to
 * know honestly whether prefill will actually work, not to optimistically
 * guess from the wrong number.
 *
 * NEVER truncates the prompt to force a fit. A truncated copy of the output
 * contract is worse than no prefill at all -- the model would never see the
 * full vocabulary, every value it guesses would be silently dropped by
 * engine/llmproposals.js, and the user would have no way to tell why. The
 * only permitted outcome when over budget is `prefilled: false`, with the
 * bare origin returned instead.
 *
 * TOTAL: never throws. An unknown/malformed target or a non-string prompt
 * still returns a usable result rather than throwing into a click handler.
 */
export function buildChatUrl(target, prompt, maxChars = MAX_PREFILL_URL_CHARS) {
  const origin = target && typeof target.origin === 'string' ? target.origin : '';
  const param = target && typeof target.param === 'string' ? target.param : '';
  const text = typeof prompt === 'string' ? prompt : '';

  if (!origin || !param || !text) {
    return { url: origin || '', prefilled: false };
  }

  const encoded = encodeURIComponent(text);
  const url = `${origin}${origin.includes('?') ? '&' : '?'}${param}=${encoded}`;
  if (url.length > maxChars) {
    return { url: origin, prefilled: false };
  }
  return { url, prefilled: true };
}
