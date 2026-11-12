"use client";
import { AdminOnly } from "@/components/Guard";
import { TodoBoard } from "@/components/todos/TodoBoard";

/** To Dos is admins-only for now, like Booking: members are sent back to the Calendar. */
export default function TodosPage() { return <AdminOnly><TodoBoard /></AdminOnly>; }
