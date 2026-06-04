import type { Metadata } from "next";
import { Outfit, Inter } from "next/font/google";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-outfit",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "PSG Advantage Portal",
  description:
    "Phoenix Solutions Group client dashboard for geographic data, survey insights, and performance analytics",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${outfit.variable} ${inter.variable}`}>
      <body className="font-body bg-canvas text-iron antialiased">
        {children}
      </body>
    </html>
  );
}
