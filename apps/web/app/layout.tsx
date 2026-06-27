import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hisaab — advance-tax clarity for freelancers",
  description:
    "Know what you owe, before the taxman does. Upload a bank statement and Hisaab separates real freelance income from noise, then estimates your quarterly advance tax (FY 2026-27, new regime).",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
