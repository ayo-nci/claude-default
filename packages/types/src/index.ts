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
