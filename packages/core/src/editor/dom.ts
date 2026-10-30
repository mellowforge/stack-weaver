/** Attribute values accepted by {@link h}; `false` and `undefined` omit the attribute, `true` sets it empty. */
export type Attrs = Record<string, string | boolean | undefined>;

/**
 * Creates an element in `doc`. Attributes are set with `setAttribute` and children are appended as
 * text nodes or elements, so no string is ever parsed as markup.
 * @internal
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Attrs = {},
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) el.append(c);
  return el;
}
