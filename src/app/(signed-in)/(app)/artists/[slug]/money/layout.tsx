"use client";
import { MoneyLayout } from "@/components/money/MoneyNav";

/** Every /money/* page: the Money sub-nav beside it for admins. Members (My money, New expense) get the page alone. */
export default function Layout({ children }: LayoutProps<"/artists/[slug]/money">) {
  return <MoneyLayout>{children}</MoneyLayout>;
}
