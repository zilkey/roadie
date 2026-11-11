import "./dom";
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { InlineValue } from "@/components/InlineValue";

type Props = Partial<Parameters<typeof InlineValue>[0]>;
function mount(props: Props = {}) {
  const calls: string[] = [];
  const onSave = props.onSave ?? (async (v: string) => { calls.push(v); return true; });
  const utils = render(createElement(InlineValue, { testid: "f", label: "Field", kind: "text", value: "Hello", canEdit: true, savedMs: 0, ...props, onSave }));
  return { calls, ...utils };
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const tid = (id: string) => screen.queryByTestId(id);

test.afterEach(() => cleanup());

test("rest: a button with the display text and the pencil; members get plain text", () => {
  mount();
  const b = tid("f")!;
  assert.equal(b.tagName, "BUTTON");
  assert.match(b.textContent ?? "", /Hello/);
  assert.ok(b.querySelector("svg.pen"), "pencil present");
  cleanup();
  mount({ canEdit: false });
  assert.equal(tid("f")!.tagName, "SPAN");
  assert.equal(tid("f")!.textContent, "Hello");
  assert.equal(tid("f")!.querySelector("svg"), null);
});

test("click opens the input with the stored value and focus", () => {
  mount();
  fireEvent.click(tid("f")!);
  const i = tid("f-input") as HTMLInputElement;
  assert.equal(i.value, "Hello");
  assert.equal(document.activeElement, i);
  assert.equal(tid("f"), null);
});

test("blur after a change saves once with the trimmed value, closes, shows Saved, then clears it", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const { calls } = mount();
  fireEvent.click(tid("f")!);
  const i = tid("f-input") as HTMLInputElement;
  fireEvent.change(i, { target: { value: "  World " } });
  fireEvent.blur(i);
  await flush();
  assert.deepEqual(calls, ["World"]);
  assert.equal(tid("f-input"), null);
  assert.ok(tid("f-saved"), "tick shows");
  await act(async () => { mock.timers.tick(1); });
  assert.equal(tid("f-saved"), null);
  mock.timers.reset();
});

test("Enter saves on text; Enter on a textarea does not", async () => {
  const a = mount();
  fireEvent.click(tid("f")!);
  fireEvent.change(tid("f-input")!, { target: { value: "Two" } });
  fireEvent.keyDown(tid("f-input")!, { key: "Enter" });
  await flush();
  assert.deepEqual(a.calls, ["Two"]);
  cleanup();
  const b = mount({ kind: "textarea" });
  fireEvent.click(tid("f")!);
  fireEvent.change(tid("f-input")!, { target: { value: "Two" } });
  fireEvent.keyDown(tid("f-input")!, { key: "Enter" });
  await flush();
  assert.deepEqual(b.calls, []);
  assert.ok(tid("f-input"), "still open");
});

test("blur with the value unchanged (after trim) calls nothing and shows no tick", async () => {
  const { calls } = mount();
  fireEvent.click(tid("f")!);
  fireEvent.change(tid("f-input")!, { target: { value: " Hello " } });
  fireEvent.blur(tid("f-input")!);
  await flush();
  assert.deepEqual(calls, []);
  assert.equal(tid("f-input"), null);
  assert.equal(tid("f-saved"), null);
});

test("Escape closes without saving, and the blur that follows does not save either", async () => {
  const { calls } = mount();
  fireEvent.click(tid("f")!);
  const i = tid("f-input")!;
  fireEvent.change(i, { target: { value: "Changed" } });
  fireEvent.keyDown(i, { key: "Escape" });
  fireEvent.blur(i);
  await flush();
  assert.deepEqual(calls, []);
  assert.equal(tid("f-input"), null);
  assert.match(tid("f")!.textContent ?? "", /Hello/);
});

test("validate's message shows under the input, keeps it open, calls nothing", async () => {
  const { calls } = mount({ validate: (v) => (v === "bad" ? "Couldn't read that." : null) });
  fireEvent.click(tid("f")!);
  fireEvent.change(tid("f-input")!, { target: { value: "bad" } });
  fireEvent.blur(tid("f-input")!);
  await flush();
  assert.deepEqual(calls, []);
  assert.ok(tid("f-input"));
  assert.equal(tid("f-error")!.textContent, "Couldn't read that.");
});

test("onSave resolving false keeps the input open and the caller's error renders", async () => {
  mount({ onSave: async () => false, error: "Couldn't save" });
  fireEvent.click(tid("f")!);
  fireEvent.change(tid("f-input")!, { target: { value: "New" } });
  fireEvent.blur(tid("f-input")!);
  await flush();
  assert.ok(tid("f-input"));
  assert.equal(tid("f-error")!.textContent, "Couldn't save");
  assert.equal(tid("f-saved"), null);
});

test("select saves on change", async () => {
  const { calls } = mount({ kind: "select", value: "a", options: [["a", "Alpha"], ["b", "Beta"]] });
  assert.match(tid("f")!.textContent ?? "", /Alpha/);
  fireEvent.click(tid("f")!);
  fireEvent.change(tid("f-input")!, { target: { value: "b" } });
  await flush();
  assert.deepEqual(calls, ["b"]);
  assert.equal(tid("f-input"), null);
});

test("an empty value rests as the empty label with the add class", () => {
  mount({ value: "", emptyLabel: "Add a note…" });
  const b = tid("f")!;
  assert.match(b.textContent ?? "", /Add a note…/);
  assert.ok(b.classList.contains("add"));
});

test("Tab out of a time input saves and moves focus to the next focusable element", async () => {
  const { calls, container } = mount({ kind: "time", value: "" });
  const next = document.createElement("button");
  next.textContent = "next";
  container.appendChild(next);
  fireEvent.click(tid("f")!);
  fireEvent.change(tid("f-input")!, { target: { value: "17:00" } });
  fireEvent.keyDown(tid("f-input")!, { key: "Tab" });
  await flush();
  assert.deepEqual(calls, ["17:00"]);
  assert.equal(tid("f-input"), null);
  assert.equal(document.activeElement, next);
});
