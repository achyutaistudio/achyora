export type Currency = "INR" | "USD";

export type Plan = {
  id: "free" | "pro-weekly" | "pro-monthly" | "pro-yearly";
  name: string;
  cadence: string;
  price: Record<Currency, string>;
  /** Charge amount in the smallest currency unit (paise / cents). */
  amount: Record<Currency, number>;
  /** Billing period length in days. Free has none. */
  periodDays: number | null;
  highlight?: boolean;
  features: string[];
};

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    cadence: "forever",
    price: { INR: "₹0", USD: "$0" },
    amount: { INR: 0, USD: 0 },
    periodDays: null,
    features: [
      "3 guest messages every 24 hours",
      "10 credits every 24 hours once signed in",
      "Chat, Research and Sanatan Research",
      "Conversation history",
    ],
  },
  {
    id: "pro-weekly",
    name: "Pro Weekly",
    cadence: "per week",
    price: { INR: "₹79", USD: "$2.99" },
    amount: { INR: 7900, USD: 299 },
    periodDays: 7,
    features: [
      "Everything in Free",
      "Higher daily limits",
      "Image and voice workspaces",
      "Priority routing",
    ],
  },
  {
    id: "pro-monthly",
    name: "Pro Monthly",
    cadence: "per month",
    price: { INR: "₹249", USD: "$8.99" },
    amount: { INR: 24900, USD: 899 },
    periodDays: 30,
    highlight: true,
    features: [
      "Everything in Pro Weekly",
      "Video workspace",
      "Library storage",
      "Long-form research briefs",
    ],
  },
  {
    id: "pro-yearly",
    name: "Pro Yearly",
    cadence: "per year",
    price: { INR: "₹1,999", USD: "$79.99" },
    amount: { INR: 199900, USD: 7999 },
    periodDays: 365,
    features: [
      "Everything in Pro Monthly",
      "Best long-term value",
      "Early access to new capabilities",
    ],
  },
];

export function detectCurrency(): Currency {
  if (typeof Intl === "undefined") return "USD";
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    return tz === "Asia/Calcutta" || tz === "Asia/Kolkata" ? "INR" : "USD";
  } catch {
    return "USD";
  }
}

export function findPlan(id: string): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}
