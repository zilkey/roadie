"use client";
import { AdminOnly } from "@/components/Guard";
import { MoneyByYear } from "@/components/money/Reports";

export default function Page() {
  return <AdminOnly><MoneyByYear /></AdminOnly>;
}
