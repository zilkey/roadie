/** The role part of a title: before " at "/" for "/",", so the company name ("… Management", "… Agency") doesn't count. */
const role = (title?: string) => (title ?? "").split(/,|\s+(?:at|for)\s+/i)[0];

/** A manager of any kind (booking manager, artist manager, "Manager at X Mgmt"). */
export const isManager = (title?: string) => /manag|\bmgmt\b/i.test(role(title));

/** A booking agent (or talent agent), e.g. "Booking agent at CAA for Tiny Habits". */
export const isAgent = (title?: string) => /\bagent\b/i.test(role(title));
