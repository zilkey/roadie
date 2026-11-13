"use client";
import { AdminOnly } from "@/components/Guard";
import { MoneyByShow } from "@/components/money/Reports";

export default function Page() {
  return <AdminOnly><MoneyByShow /></AdminOnly>;
}
