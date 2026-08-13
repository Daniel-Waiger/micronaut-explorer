// The manual-paste provider: wraps today's copy-paste workflow behind the
// same Provider interface (provider.js) a real network adapter uses, so the
// app has two WORKING providers from day one -- one that needs no server at
// all -- rather than the seam existing only on paper until Ollama is
// configured. This is also the automatic fallback when the Ollama provider
// is unavailable (server down, not configured): the feature degrades to
// "here is the text, go paste it yourself" instead of erroring.
//
// There is no model on this side of a copy-paste, so complete() cannot
// actually complete anything: it resolves with the composed prompt as
// `text` and `json: null`. The caller is responsible for presenting that
// text for the user to copy (ui/clipboard.js) and for accepting whatever
// the user pastes back through its own channel -- this provider's job stops
// at "produce the exact text a human should paste".
//
// isAvailable() is always true: there is no server that could be down.

/**
 * `composeMessage({system, user})` turns the two message parts into the one
 * block a human copies; defaults to the two parts joined with a blank line,
 * matching how engine/render/llmprompt.js already composes its own preamble
 * + payload.
 */
export function createManualPasteProvider({ composeMessage } = {}) {
  const compose =
    typeof composeMessage === 'function'
      ? composeMessage
      : ({ system, user }) => [system, user].filter(Boolean).join('\n\n');

  return {
    id: 'manual-paste',
    label: 'Copy to my own LLM',
    isAvailable: () => true,
    async complete({ system, user } = {}) {
      return { text: compose({ system, user }), json: null };
    },
  };
}
