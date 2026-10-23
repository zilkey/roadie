import { redirect } from "next/navigation";
import { ARTISTS_PATH } from "@/lib/routes";
/** Your artist (or the picker when you have several): /artists decides. */
export default function Index() { redirect(ARTISTS_PATH); }
