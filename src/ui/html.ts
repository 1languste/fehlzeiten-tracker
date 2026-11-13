/** Sicheres HTML-Template: eingesetzte Werte werden maskiert, außer sie sind selbst `html`/`raw`. */

export class Html {
  constructor(private readonly s: string) {}
  toString(): string { return this.s; }
}

export type Value = string | number | boolean | null | undefined | Html | Value[];

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function render(v: Value): string {
  if (v === null || v === undefined || v === false || v === true) return "";
  if (v instanceof Html) return v.toString();
  if (Array.isArray(v)) return v.map(render).join("");
  return esc(String(v));
}

export function html(strings: TemplateStringsArray, ...values: Value[]): Html {
  let out = strings[0] ?? "";
  values.forEach((v, i) => { out += render(v) + (strings[i + 1] ?? ""); });
  return new Html(out);
}

/** Nur für vertrauenswürdige, selbst erzeugte Fragmente. */
export const raw = (s: string): Html => new Html(s);
