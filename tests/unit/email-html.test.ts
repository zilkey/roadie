import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeHtml, htmlToText, textToHtml, decodeEntities, splitQuotedHtml, displayHtml, fillTemplateHtml } from "@/lib/email-html";

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
  assert.equal(sanitizeHtml("<a href='mailto:h@pinehollow.example'>mail</a>"), '<a href="mailto:h@pinehollow.example" rel="noopener">mail</a>');
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
  assert.equal(sanitizeHtml("<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>"), "<div>a b </div><div>c </div>");
});

test("sanitizeHtml is idempotent", () => {
  const dirty = '<div dir="ltr"><p>A &amp; B <a href="https://x.example?a=1&b=2">l</a></p><ul><li>x</li></ul><script>y</script></div>';
  const once = sanitizeHtml(dirty);
  assert.equal(sanitizeHtml(once), once);
});

test("htmlToText: blocks become newlines, list items dashes, links text (href)", () => {
  assert.equal(htmlToText("<p>Hi Rosa,</p><p>Dec 11 works.<br>Thanks!</p>"), "Hi Rosa,\n\nDec 11 works.\nThanks!");
  assert.equal(htmlToText("<div>one</div><div>two</div>"), "one\ntwo");
  assert.equal(htmlToText("<p>List:</p><ul><li>apples</li><li>pears <b>ripe</b></li></ul><p>End</p>"), "List:\n\n- apples\n- pears ripe\n\nEnd");
  assert.equal(htmlToText('<p>See <a href="https://band.example/epk">our page</a> or <a href="https://x.example">https://x.example</a>.</p>'), "See our page (https://band.example/epk) or https://x.example.");
  assert.equal(htmlToText('<a href="mailto:h@x.example">h@x.example</a> and <a href="mailto:h@x.example">email Rosa</a>'), "h@x.example and email Rosa (h@x.example)");
  assert.equal(htmlToText("<p>a &amp; b &lt;c&gt; &nbsp;d</p>"), "a & b <c> d");
  assert.equal(htmlToText("<p>x</p><script>alert(1)</script>"), "x");
  assert.equal(htmlToText('<a href="javascript:x()">bad</a>'), "bad");
  assert.equal(htmlToText("  <p>  spaced   out  </p>  "), "spaced out");
  assert.equal(htmlToText(""), "");
});

test("textToHtml: paragraphs on blank lines, <br> on single newlines, URLs linked, markup escaped", () => {
  assert.equal(textToHtml("Hi Rosa,\n\nDec 11 works.\nThanks!"), "<p>Hi Rosa,</p><p>Dec 11 works.<br>Thanks!</p>");
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

test("sanitizeHtml: bold, italic and underline set by style survive (Google Docs, Gmail, Outlook pastes)", () => {
  // Google Docs: the whole paste in <b style="font-weight:normal">, formatting on spans.
  const docs = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr" style="line-height:1.38"><span style="font-weight:700;font-style:normal">Bold</span> <span style="font-style:italic">it</span> <span style="text-decoration:underline;-webkit-text-decoration-skip:none">un</span> <span style="font-weight:400">plain</span></p></b>';
  assert.equal(sanitizeHtml(docs), "<p><b>Bold</b> <i>it</i> <u>un</u> plain</p>");
  assert.equal(sanitizeHtml('<span style="font-weight: bold; font-style: italic; text-decoration-line: underline">all</span>'), "<b><i><u>all</u></i></b>");
  assert.equal(sanitizeHtml('<font style="FONT-WEIGHT: 600">heavy</font> <span style="font-weight:300">light</span>'), "<b>heavy</b> light");
  assert.equal(sanitizeHtml('<strong style="font-weight:bold">once</strong> <em style="font-style:italic">once</em>'), "<strong>once</strong> <em>once</em>");
  assert.equal(sanitizeHtml('<i style="font-style:normal">not italic</i>'), "not italic");
  assert.equal(sanitizeHtml('<span style="color:red">no formatting</span>'), "no formatting");
  assert.equal(sanitizeHtml("<h2>Tour dates</h2>"), "<p><b>Tour dates</b></p>");
  assert.equal(sanitizeHtml('<p>a<img src="x.png">b<hr>c</p>'), "<p>abc</p>");
  assert.equal(sanitizeHtml("<blockquote>q</blockquote>"), "<blockquote>q</blockquote>");
});

test("sanitizeHtml: newTab links open in a new tab without a referrer", () => {
  assert.equal(sanitizeHtml('<a href="https://x.example">x</a>', { newTab: true }), '<a href="https://x.example" target="_blank" rel="noopener noreferrer">x</a>');
});

test("splitQuotedHtml: cuts at Gmail, Apple Mail and Outlook quote markers", () => {
  const gmail = '<div dir="ltr">Yes, <b>Friday</b> works.</div><br><div class="gmail_quote gmail_quote_container"><div class="gmail_attr">On Mon wrote:</div><blockquote class="gmail_quote">old</blockquote></div>';
  const g = splitQuotedHtml(gmail);
  assert.equal(sanitizeHtml(g.html), "<div>Yes, <b>Friday</b> works.</div><br>");
  assert.match(g.quoted, /^<div class="gmail_quote/);
  assert.equal(splitQuotedHtml('<p>Hi</p><blockquote type="cite">old</blockquote>').html, "<p>Hi</p>");
  assert.equal(splitQuotedHtml('<p>Hi</p><hr><div id="divRplyFwdMsg">From: x</div>').html, "<p>Hi</p><hr>");
  assert.deepEqual(splitQuotedHtml("<p>No quote</p>"), { html: "<p>No quote</p>", quoted: "" });
});

test("displayHtml: sanitized main part and quote; null when there's nothing to show or the quote can't be found", () => {
  const r = displayHtml('<div>See <u>this</u> <a href="https://x.example">link</a><script>bad()</script></div><div class="gmail_quote">On Mon wrote:<blockquote>old</blockquote></div>', "See this link\n\nOn Mon wrote:\n> old");
  assert.deepEqual(r, { html: '<div>See <u>this</u> <a href="https://x.example" target="_blank" rel="noopener noreferrer">link</a></div>', quotedHtml: "<div>On Mon wrote:<blockquote>old</blockquote></div>" });
  assert.equal(displayHtml(undefined, "plain"), null);
  assert.equal(displayHtml("<div> </div>", "plain"), null);
  // The plain text has a quote the HTML doesn't mark: show the plain text, which the page splits.
  assert.equal(displayHtml("<p>Hi</p><p>On Mon, Rosa wrote:</p><p>old</p>", "Hi\n\nOn Mon, Rosa wrote:\n> old"), null);
  assert.deepEqual(displayHtml("<p><b>Hi</b></p>", "Hi"), { html: "<p><b>Hi</b></p>", quotedHtml: "" });
});

test("fillTemplateHtml: fills fields escaped, keeps the formatting, links URL values", () => {
  const html = "<p>Hi <b>{{contact.firstName}}</b>, here's our video: {{artist.video}} {{venue.city}}</p>";
  assert.equal(fillTemplateHtml(html, { "contact.firstName": "Rosa <R&B>", "artist.video": "https://v.example/x" }),
    '<p>Hi <b>Rosa &lt;R&amp;B&gt;</b>, here\'s our video: <a href="https://v.example/x" rel="noopener">https://v.example/x</a> {{venue.city}}</p>');
});
