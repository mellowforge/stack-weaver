/** Values a message template can take for its `{name}` placeholders. */
type MessageParams = Readonly<Record<string, string | number>>;

/**
 * A message that depends on a count. `other` is required; `zero` (used for a count of 0 when present) and the
 * CLDR categories (`one`, `two`, `few`, `many`) are optional. Every text may use `{count}`.
 */
export type PluralMessage = { readonly other: string } & Readonly<Partial<Record<'zero' | Intl.LDMLPluralRule, string>>>;

/**
 * Fills the `{name}` placeholders of `template` from `params`, in one pass: every occurrence is filled, a
 * placeholder without a parameter stays as written, and parameter text is inserted literally (a value such as
 * `{name}` is never expanded again).
 * @param template - Text with `{name}` placeholders.
 * @param params - Values by placeholder name.
 * @returns The filled text.
 */
export function formatMessage(template: string, params: MessageParams = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : whole));
}

const rulesByLocale = new Map<string, Intl.PluralRules>();

/**
 * Picks the text of `message` for `count` and fills it. A count of 0 uses `zero` when it is given; otherwise the
 * plural category of `locale` decides, falling back to `other`. `{count}` is always available as a parameter.
 * @param message - The texts by plural category.
 * @param count - The number the message is about.
 * @param locale - A BCP 47 language tag. Default `'en'`.
 * @param params - Further placeholder values.
 * @returns The filled text.
 */
export function formatPlural(message: PluralMessage, count: number, locale = 'en', params: MessageParams = {}): string {
  let template: string | undefined;
  if (count === 0) template = message.zero;
  if (template === undefined) {
    let rules = rulesByLocale.get(locale);
    if (!rules) {
      rules = new Intl.PluralRules(locale);
      rulesByLocale.set(locale, rules);
    }
    template = message[rules.select(count)];
  }
  return formatMessage(template ?? message.other, { ...params, count });
}
