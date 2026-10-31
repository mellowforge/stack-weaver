/** Values a message template can take for its `{name}` placeholders. */
export type MessageParams = Readonly<Record<string, string | number>>;

/**
 * A message that depends on a count. `other` is required; the rest are optional: `none`, the text for exactly 0
 * (such as "No problems"), and the CLDR plural categories (`zero`, `one`, `two`, `few`, `many`) that the locale's
 * plural rules select. `zero` is only that category: some languages select it for more than 0 (Latvian for 10, say)
 * and English never selects it. Every text may use `{count}`.
 */
export type PluralMessage = { readonly other: string } & Readonly<Partial<Record<'none' | Intl.LDMLPluralRule, string>>>;

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

/** The plural rules of `locale`; English for a tag `Intl` rejects. */
function pluralRules(locale: string): Intl.PluralRules {
  let rules = rulesByLocale.get(locale);
  if (rules) return rules;
  try {
    rules = new Intl.PluralRules(locale);
  } catch {
    // Not cached under the bad tag: a host cannot grow the map with junk.
    return locale === 'en' ? new Intl.PluralRules() : pluralRules('en');
  }
  rulesByLocale.set(locale, rules);
  return rules;
}

/**
 * Picks the text of `message` for `count` and fills it. A count of 0 uses `none` when it is given; otherwise the
 * plural category of `locale` decides (which may be `zero`), falling back to `other`. `{count}` is always available
 * as a parameter.
 * @param message - The texts by plural category.
 * @param count - The number the message is about.
 * @param locale - A BCP 47 language tag; an invalid one counts as `'en'`. Default `'en'`.
 * @param params - Further placeholder values.
 * @returns The filled text.
 */
export function formatPlural(message: PluralMessage, count: number, locale = 'en', params: MessageParams = {}): string {
  let template: string | undefined;
  if (count === 0) template = message.none;
  if (template === undefined) {
    template = message[pluralRules(locale).select(count)];
  }
  return formatMessage(template ?? message.other, { ...params, count });
}
