import { APP_NAME } from "@apex/shared";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description:
    "A self-hosted garage for car enthusiasts: car profiles, build logs, maintenance and the Crew Chief AI assistant.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-GB">
      <body className="bg-white text-neutral-950 antialiased dark:bg-neutral-950 dark:text-neutral-50">
        {children}
      </body>
    </html>
  );
}
