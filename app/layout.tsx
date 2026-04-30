import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "m-master",
  description: "Context-aware marketing platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          fontFamily: "sans-serif",
          background: "#ffffff",
          color: "#1d1d1f",
        }}
      >
        {children}
      </body>
    </html>
  );
}
