import type { ReactNode } from "react";

export const metadata = {
  title: "Web",
  description: "Web app"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
