import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { RentSnapshot } from "@repo/types";

async function loadSnapshot(): Promise<RentSnapshot> {
  const path = join(process.cwd(), "../../data/rent/listings.json");
  const fallback: RentSnapshot = {
    fetchedAt: new Date(0).toISOString(),
    source: "https://www.rent.ie/rooms-to-rent/renting_dublin/room-type_either/",
    listings: []
  };
  try {
    const raw = (await fs.readFile(path, "utf8")).trim();
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<RentSnapshot>) } as RentSnapshot;
  } catch {
    return fallback;
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toUTCString();
}

export const metadata = {
  title: "rent.ie ensuite rooms — Dublin",
  description: "Auto-updated list of ensuite rooms in Dublin from rent.ie"
};

export default async function RentPage() {
  const { listings, fetchedAt, source } = await loadSnapshot();

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px", fontFamily: "system-ui, sans-serif" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Ensuite rooms — Dublin</h1>
        <p style={{ color: "#666", margin: "4px 0 0" }}>
          {listings.length} listing{listings.length === 1 ? "" : "s"} · last checked {formatTime(fetchedAt)} ·{" "}
          <a href={source}>source</a>
        </p>
      </header>

      {listings.length === 0 ? (
        <p>No ensuite listings yet. The scraper runs every 30 minutes.</p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16
          }}
        >
          {listings.map((l) => (
            <li
              key={l.id}
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
                href={l.url}
                target="_blank"
                rel="noreferrer noopener"
                style={{ color: "inherit", textDecoration: "none", display: "flex", flexDirection: "column", height: "100%" }}
              >
                {l.imageUrl ? (
                  <img
                    src={l.imageUrl}
                    alt={l.title}
                    loading="lazy"
                    style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", background: "#f6f6f6" }}
                  />
                ) : (
                  <div style={{ aspectRatio: "4 / 3", background: "#f6f6f6" }} />
                )}
                <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                  <strong style={{ fontSize: 15, lineHeight: 1.3 }}>{l.title}</strong>
                  {l.area && <span style={{ fontSize: 13, color: "#555" }}>{l.area}</span>}
                  {l.price && <span style={{ fontSize: 14 }}>{l.price}</span>}
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
