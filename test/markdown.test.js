import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { MarkdownMessage } from "../src/components/markdown";

describe("MarkdownMessage", () => {
  test("renders basic markdown", () => {
    const html = renderToStaticMarkup(
      MarkdownMessage({
        body: "# Title\n\n- a\n- b\n\n`inline`\n\n```js\nconst x = 1\n```\n\n> quote\n\n[a](https://example.com)",
      })
    );

    expect(html).toContain("<h1");
    expect(html).toContain("<ul");
    expect(html).toContain("<code");
    expect(html).toContain("<pre");
    expect(html).toContain("<blockquote");
    expect(html).toContain('href="https://example.com"');
  });

  test("sanitizes/does not render raw HTML", () => {
    const html = renderToStaticMarkup(
      MarkdownMessage({
        body: "Hello<script>alert('x')</script> <img src=x onerror=alert(1) />",
      })
    );

    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror=");
  });

  test("tables render in a scroll container", () => {
    const html = renderToStaticMarkup(
      MarkdownMessage({
        body: "| a | b |\n|---|---|\n| 1 | 2 |",
      })
    );
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("<table");
  });
});
