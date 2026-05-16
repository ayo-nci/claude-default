import type { ReactNode } from "react";

export const metadata = {
  title: "Dunnes Men's — under €10",
  description: "Auto-updated list of men's clothing items under €10 on dunnesstores.com"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#fafafa", color: "#111" }}>{children}</body>
    </html>
  );
}
