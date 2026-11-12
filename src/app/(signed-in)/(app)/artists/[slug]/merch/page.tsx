"use client";
import { AdminOnly } from "@/components/Guard";
import { MerchPage } from "@/components/merch/MerchPage";

export default function Page() { return <AdminOnly><MerchPage /></AdminOnly>; }
