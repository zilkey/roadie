import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeHtml, htmlToText, textToHtml, decodeEntities } from "@/lib/email-html";

test("sanitizeHtml: keeps the allowlist, drops attributes, closes what was left open", () => {
  assert.equal(sanitizeHtml('<p class="x" style="color:red">Hi <b onclick="x()">there</b> <i>you</i> <em>e</em> <strong>s</strong> <u>u</u></p>'), "<p>Hi <b>there</b> <i>you</i> <em>e</em> <strong>s</strong> <u>u</u></p>");
  assert.equal(sanitizeHtml("<ul><li>one<li>two</ul>"), "<ul><li>one<li>two</li></li></ul>");
  assert.equal(sanitizeHtml("<div>a<br/>b<BR>c</div>"), "<div>a<br>b<br>c</div>");
  assert.equal(sanitizeHtml("<p>unclosed <b>bold"), "<p>unclosed <b>bold</b></p>");
  assert.equal(sanitizeHtml("stray </b> close"), "stray  close");
  assert.equal(sanitizeHtml(""), "");
});

test("sanitizeHtml: links keep only a safe href and get rel=noopener", () => {
  assert.equal(sanitizeHtml('<a href="https://x.example/a?b=1&amp;c=2" target="_blank" onclick="evil()">go</a>'), '<a href="https://x.example/a?b=1&amp;c=2" rel="noopener">go</a>');
  assert.equal(sanitizeHtml("<a href='mailto:h@lostlake.example'>mail</a>"), '<a href="mailto:h@lostlake.example" rel="noopener">mail</a>');
  assert.equal(sanitizeHtml('<a href="http://x.example">h</a>'), '<a href="http://x.example" rel="noopener">h</a>');
  assert.equal(sanitizeHtml('<a title="t">no href</a>'), "no href");
  assert.equal(sanitizeHtml('<a href="/relative">rel</a>'), "rel");
});

test("sanitizeHtml: XSS cases", () => {
  assert.equal(sanitizeHtml('<p>a</p><script>alert(1)</script><p>b</p>'), "<p>a</p><p>b</p>", "script and its code are gone");
  assert.equal(sanitizeHtml("<style>p{color:red}</style>x"), "x");
  for (const href of ["javascript:alert(1)", " JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "jav&#x61;script:alert(1)", "&#106;avascript:alert(1)", "data:text/html,<script>x</script>", "vbscript:x", "//evil.example", "\u0001javascript:x"]) {
    const out = sanitizeHtml(`<a href="${href}">click</a>`);
    assert.equal(out, "click", `href ${JSON.stringify(href)} -> ${out}`);
  }
  assert.equal(sanitizeHtml('<img src=x onerror="alert(1)">pic'), "pic", "an img is unwrapped to nothing");
  assert.equal(sanitizeHtml('<p onmouseover="x()">hi</p>'), "<p>hi</p>");
  assert.equal(sanitizeHtml('<iframe src="https://evil.example">inner</iframe>after'), "after");
  assert.equal(sanitizeHtml("<svg onload=alert(1)><b>t</b></svg>"), "<b>t</b>");
  assert.doesNotMatch(sanitizeHtml('<a href="https://x.example" "onclick="x()">q</a>'), /<a[^>]*onclick/, "broken quoting can't smuggle an attribute");
  assert.equal(sanitizeHtml("&lt;script&gt;alert(1)&lt;/script&gt;"), "&lt;script&gt;alert(1)&lt;/script&gt;", "escaped text stays text");
  assert.equal(sanitizeHtml("1 < 2 && 3 > 2"), "1 &lt; 2 &amp;&amp; 3 &gt; 2");
  assert.equal(sanitizeHtml("<!-- <script> --><b>x</b>"), "<b>x</b>");
});

test("sanitizeHtml: nested formatting and nested links", () => {
  assert.equal(sanitizeHtml("<b><i><u>all</u></i></b>"), "<b><i><u>all</u></i></b>");
  assert.equal(sanitizeHtml('<b>x <a href="https://a.example"><i>link</i></a></b>'), '<b>x <a href="https://a.example" rel="noopener"><i>link</i></a></b>');
  assert.equal(sanitizeHtml('<a href="https://a.example">one <a href="https://b.example">two</a> three</a>'), '<a href="https://a.example" rel="noopener">one two three</a>');
  assert.equal(sanitizeHtml("<table><tr><td>cell</td></tr></table>"), "cell");
});

test("sanitizeHtml is idempotent", () => {
  const dirty = '<div dir="ltr"><p>A &amp; B <a href="https://x.example?a=1&b=2">l</a></p><ul><li>x</li></ul><script>y</script></div>';
  const once = sanitizeHtml(dirty);
  assert.equal(sanitizeHtml(once), once);
});

test("htmlToText: blocks become newlines, list items dashes, links text (href)", () => {
  assert.equal(htmlToText("<p>Hi Haylee,</p><p>Dec 11 works.<br>Thanks!</p>"), "Hi Haylee,\n\nDec 11 works.\nThanks!");
  assert.equal(htmlToText("<div>one</div><div>two</div>"), "one\ntwo");
  assert.equal(htmlToText("<p>List:</p><ul><li>apples</li><li>pears <b>ripe</b></li></ul><p>End</p>"), "List:\n\n- apples\n- pears ripe\n\nEnd");
  assert.equal(htmlToText('<p>See <a href="https://band.example/epk">our page</a> or <a href="https://x.example">https://x.example</a>.</p>'), "See our page (https://band.example/epk) or https://x.example.");
  assert.equal(htmlToText('<a href="mailto:h@x.example">h@x.example</a> and <a href="mailto:h@x.example">email Haylee</a>'), "h@x.example and email Haylee (h@x.example)");
  assert.equal(htmlToText("<p>a &amp; b &lt;c&gt; &nbsp;d</p>"), "a & b <c> d");
  assert.equal(htmlToText("<p>x</p><script>alert(1)</script>"), "x");
  assert.equal(htmlToText('<a href="javascript:x()">bad</a>'), "bad");
  assert.equal(htmlToText("  <p>  spaced   out  </p>  "), "spaced out");
  assert.equal(htmlToText(""), "");
});

test("textToHtml: paragraphs on blank lines, <br> on single newlines, URLs linked, markup escaped", () => {
  assert.equal(textToHtml("Hi Haylee,\n\nDec 11 works.\nThanks!"), "<p>Hi Haylee,</p><p>Dec 11 works.<br>Thanks!</p>");
  assert.equal(textToHtml("a\r\n\r\n\r\nb"), "<p>a</p><p>b</p>");
  assert.equal(textToHtml("See https://band.example/epk?a=1&b=2."), '<p>See <a href="https://band.example/epk?a=1&amp;b=2" rel="noopener">https://band.example/epk?a=1&amp;b=2</a>.</p>');
  assert.equal(textToHtml("<script>alert(1)</script> & co"), "<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; co</p>");
  assert.equal(textToHtml("javascript:alert(1)"), "<p>javascript:alert(1)</p>");
  assert.equal(textToHtml(""), "");
  assert.equal(textToHtml("\n\n"), "");
  // it round-trips through the sanitizer and back to the same text
  const text = "Hi,\n\nLine one\nLine two\n\nBye";
  assert.equal(htmlToText(sanitizeHtml(textToHtml(text))), text);
});

test("decodeEntities", () => {
  assert.equal(decodeEntities("&amp; &lt; &#65; &#x42; &quot; &unknown; &#0;"), '& < A B " &unknown; ');
});
