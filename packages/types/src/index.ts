export interface DealItem {
  id: string;
  name: string;
  price: number;
  currency: string;
  url: string;
  imageUrl: string | null;
}

export interface DealsSnapshot {
  fetchedAt: string;
  source: string;
  threshold: number;
  currency: string;
  items: DealItem[];
}

export interface RentListing {
  id: string;
  url: string;
  title: string;
  price: string | null;
  area: string | null;
  imageUrl: string | null;
  description: string | null;
  agent: string | null;
  agentPhone: string | null;
  firstSeenAt: string;
}

export interface RentSnapshot {
  fetchedAt: string;
  source: string;
  listings: RentListing[];
}
