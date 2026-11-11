import type { z } from "zod";
import type { region } from "@/schema/common";

export type Region = z.infer<typeof region>;

/** What each region is called (the venue form's Region select, Booking's Venue calendars filter). */
export const REGION_LABEL: Record<Region, string> = { boulder: "Boulder", denver: "Denver", north: "North", south: "South", mountains: "Mountains", southwest: "Southwest", out: "Out of state" };

/** Which of the band's regions a Colorado town is in. Out of state is always "out". */
const REGION_CITIES: [Region, RegExp][] = [
  ["boulder", /boulder|longmont|lyons|lafayette|gold hill|jamestown|hygiene|gunbarrel|louisville|superior|niwot|erie/i],
  ["denver", /denver|westminster|arvada|castle rock|englewood|golden|parker|wheat ridge|broomfield|aurora|lakewood|littleton|thornton|highlands ranch|morrison|evergreen/i],
  ["north", /fort collins|loveland|greeley|milliken|berthoud|windsor|northern co|estes park|wellington/i],
  ["south", /colorado springs|manitou|divide|pueblo|ca[nñ]on city|monument|woodland park/i],
  ["mountains", /idaho springs|silver plume|buena vista|salida|carbondale|nederland|conifer|dillon|frisco|breckenridge|steamboat|vail|ridgway|palisade|glenwood|aspen|crested butte|gunnison|leadville|winter park|fraser|grand junction/i],
  ["southwest", /durango|cortez|dolores|pagosa|del norte|alamosa|montrose|telluride/i],
];
export function regionForCity(city: string, state = "CO"): Region | undefined {
  if (state && state.toUpperCase() !== "CO") return "out";
  return REGION_CITIES.find(([, re]) => re.test(city))?.[0];
}
