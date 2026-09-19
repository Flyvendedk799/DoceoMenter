import { describe, expect, it } from "vitest";
import { extractHtmlIdentity } from "./productSurfaces.js";

describe("extractHtmlIdentity", () => {
  it("reads Futurematch course marketplace identity from Landing.html-style markup", () => {
    const html = `<!DOCTYPE html><html><head>
<title>Futurematch — Danmarks kursusmarkedsplads</title>
<meta name="description" content="Futurematch samler kurser fra Danmarks bedste udbydere ét sted.">
<meta property="og:title" content="Futurematch — Danmarks kursusmarkedsplads">
</head><body>
<h1 class="lp-h1 display">Find dit <span class="ital">næste kursus</span></h1>
</body></html>`;
    const id = extractHtmlIdentity(html);
    expect(id?.title).toMatch(/Futurematch/i);
    expect(id?.description).toMatch(/kurser/i);
    expect(id?.text).toMatch(/kursus/i);
  });

  it("returns undefined when no identity signals exist", () => {
    expect(extractHtmlIdentity("<html><body><div></div></body></html>")).toBeUndefined();
  });
});
