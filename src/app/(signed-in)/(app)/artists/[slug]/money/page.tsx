"use client";
import { useProfile } from "@/lib/auth";
import { AdminMoney } from "@/components/money/AdminMoney";
import { MyMoney } from "@/components/money/MyMoney";

export default function Money() {
  const p = useProfile();
  return p.role === "admin" ? <AdminMoney /> : <MyMoney />;
}
