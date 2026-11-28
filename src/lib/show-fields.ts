import type { ShowField } from "@/schema";

/**
 * A show's value for one of the artist's show fields: its own value (an override) if it has one, else the field's default.
 * `overridden` is true only when the show has its own value and the field has a default it replaces.
 */
export function showFieldValue(f: Pick<ShowField, "id" | "defaultValue">, values: { fieldId: string; value: string }[] | undefined) {
  const own = values?.find((v) => v.fieldId === f.id)?.value;
  return { value: own ?? f.defaultValue ?? "", own: own ?? null, isDefault: own === undefined && !!f.defaultValue, overridden: own !== undefined && !!f.defaultValue };
}
