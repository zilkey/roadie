"use client";
import { BookingLayout } from "@/components/booking/BookingNav";

/** Every /booking/* page: the Booking sub-nav beside it for admins. Not AdminOnly: members open venue pages here. */
export default function Layout({ children }: LayoutProps<"/artists/[slug]/booking">) {
  return <BookingLayout>{children}</BookingLayout>;
}
