"use client";
import { AdminOnly } from "@/components/Guard";
import { MoneyByCategory } from "@/components/money/Reports";

export default function Page() {
  return <AdminOnly><MoneyByCategory /></AdminOnly>;
}
