import { describe, expect, it } from "vitest";
import { html, raw } from "./html";

describe("html", () => {
  it("maskiert eingesetzte Werte standardmäßig", () => {
    const evil = `<img src=x onerror="alert(1)">`;
    expect(String(html`<p>${evil}</p>`)).toBe("<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>");
    expect(String(html`<input value="${`" onfocus="x`}">`)).toBe(`<input value="&quot; onfocus=&quot;x">`);
  });

  it("lässt raw() und verschachtelte html-Fragmente unverändert", () => {
    expect(String(html`<ul>${raw("<li>a</li>")}</ul>`)).toBe("<ul><li>a</li></ul>");
    const inner = html`<b>${"<x>"}</b>`;
    expect(String(html`<p>${inner}</p>`)).toBe("<p><b>&lt;x&gt;</b></p>");
  });

  it("setzt Listen zusammen und ignoriert null, undefined und false", () => {
    const items = ["a", "<b>"].map((x) => html`<li>${x}</li>`);
    expect(String(html`<ul>${items}</ul>`)).toBe("<ul><li>a</li><li>&lt;b&gt;</li></ul>");
    expect(String(html`[${null}${undefined}${false}${0}]`)).toBe("[0]");
  });
});
