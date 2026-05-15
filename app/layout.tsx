import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";

import "./globals.css";

import "./globals.css";

export const metadata: Metadata = {
  title: "m-master",
  description: "Context-aware marketing studio for multi-channel content operations",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
