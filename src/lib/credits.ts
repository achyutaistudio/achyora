/** Single source of truth for ACHYORA AI credit costs. Server enforcement remains in spend_credits. */
export const CREDIT_COSTS = {
  chat: 1,
  comparePerModel: 1,
  research: 2,
  sanatanResearch: 2,
  image: 3,
  video: 8,
  voice: 2,
} as const;

export type CreditOperation = keyof typeof CREDIT_COSTS;
