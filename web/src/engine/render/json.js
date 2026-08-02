// JSON renderer over engine/studydoc.js's document model -- the "raw data"
// export sibling of render/markdown.js and render/mermaid.js. Pure
// function: no DOM, no store. buildStudyDocument is already deterministic
// (see studydoc.js's header), so a plain stringify is deterministic too --
// no key-sorting pass needed on top.
//
// TOTAL: never throws. JSON.stringify only throws on a BigInt or a
// circular reference, neither of which studydoc.js's plain-object/array/
// string/number/null shape can produce.
export function renderJson(doc) {
  return JSON.stringify(doc ?? null, null, 2);
}
