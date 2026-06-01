import type { Metadata } from "next";
import { gotham, didact } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Phoenix Solutions Group",
  description: "PSG client hub — marketing analytics, automation, and ops for your shop.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${gotham.variable} ${didact.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
