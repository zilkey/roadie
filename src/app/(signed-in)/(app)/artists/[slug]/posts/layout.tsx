import { SocialMediaFrame } from "@/components/posts/SocialMediaFrame";

/** Posts, Photos and each post's editor share the Social Media checklists sidebar. */
export default function PostsLayout({ children }: { children: React.ReactNode }) {
  return <SocialMediaFrame>{children}</SocialMediaFrame>;
}
