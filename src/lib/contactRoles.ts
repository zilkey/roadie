/** A manager of any kind (booking manager, artist manager, "Manager at X Mgmt"), judged on the role before " at "/" for "/",",
 *  so a booking agent at a "… Management" company isn't one. */
export const isManager = (title?: string) => /manag|\bmgmt\b/i.test((title ?? "").split(/,|\s+(?:at|for)\s+/i)[0]);
