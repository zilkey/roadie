"use client";
import { AdminOnly } from "@/components/Guard";
import { Stub } from "@/components/ui";
export default function Booking() { return <AdminOnly><Stub title="Booking" slice={3} /></AdminOnly>; }
