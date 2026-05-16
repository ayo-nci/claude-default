import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { DealsSnapshot } from "@repo/types";

async function loadSnapshot(): Promise<DealsSnapshot> {
  const path = join(process.cwd(), "../../data/items.json");
  const fallback: DealsSnapshot = {
    fetchedAt: new Date(0).toISOString(),
    source: "https://www.dunnesstores.com/men/clothing",
    threshold: 10,
    currency: "EUR",
    items: []
  };
  try {
    const raw = (await fs.readFile(path, "utf8")).trim();
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<DealsSnapshot>) } as DealsSnapshot;
  } catch {
    return fallback;
  }
}

function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-IE", { style: "currency", currency }).format(price);
  } catch {
    return `${currency} ${price.toFixed(2)}`;
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toUTCString();
}

export default async function HomePage() {
  const snapshot = await loadSnapshot();
  const { items, fetchedAt, source, threshold, currency } = snapshot;

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px", fontFamily: "system-ui, sans-serif" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Dunnes Men&apos;s — under {formatPrice(threshold, currency)}</h1>
        <p style={{ color: "#666", margin: "4px 0 0" }}>
          {items.length} item{items.length === 1 ? "" : "s"} · last checked {formatTime(fetchedAt)} ·{" "}
          <a href={source}>source</a> · <a href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/rent/`}>rent.ie ensuite rooms →</a>
        </p>
      </header>

      {items.length === 0 ? (
        <p>No items found yet. The scraper runs on a schedule; check back shortly.</p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 16
          }}
        >
          {items.map((item) => (
            <li
              key={item.id}
              style={{
                border: "1px solid #eee",
                borderRadius: 8,
                overflow: "hidden",
                background: "#fff",
                display: "flex",
                flexDirection: "column"
              }}
            >
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer noopener"
                style={{ color: "inherit", textDecoration: "none", display: "flex", flexDirection: "column", height: "100%" }}
              >
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    loading="lazy"
                    style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", background: "#f6f6f6" }}
                  />
                ) : (
                  <div style={{ aspectRatio: "1 / 1", background: "#f6f6f6" }} />
                )}
                <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                  <span style={{ fontSize: 14, lineHeight: 1.3 }}>{item.name}</span>
                  <strong style={{ fontSize: 16 }}>{formatPrice(item.price, item.currency)}</strong>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
