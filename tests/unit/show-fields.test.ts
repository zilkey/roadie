import { test } from "node:test";
import assert from "node:assert/strict";
import { showFieldValue } from "@/lib/show-fields";

test("showFieldValue: own value overrides the default; no default means no override", () => {
  const vals = [{ fieldId: "h", value: "Marriott" }];
  assert.deepEqual(showFieldValue({ id: "h", defaultValue: "Motel 6" }, vals), { value: "Marriott", own: "Marriott", isDefault: false, overridden: true });
  assert.deepEqual(showFieldValue({ id: "h", defaultValue: "Motel 6" }, []), { value: "Motel 6", own: null, isDefault: true, overridden: false });
  assert.deepEqual(showFieldValue({ id: "h" }, vals), { value: "Marriott", own: "Marriott", isDefault: false, overridden: false });
  assert.deepEqual(showFieldValue({ id: "h" }, undefined), { value: "", own: null, isDefault: false, overridden: false });
});
