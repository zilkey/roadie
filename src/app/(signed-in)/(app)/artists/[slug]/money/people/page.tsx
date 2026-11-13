"use client";
import { AdminOnly } from "@/components/Guard";
import { MoneyByPerson } from "@/components/money/Reports";

export default function Page() {
  return <AdminOnly><MoneyByPerson /></AdminOnly>;
}
