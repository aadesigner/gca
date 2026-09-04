/** USDT payment options shown in the client credits flow. */
export const CRYPTO_WALLET_ADDRESS = "0xf65fB66400C6F5e256f50b8C913026B6C2Ce56bF";

export const MIN_CRYPTO_DEPOSIT_USD = 50;

export const MAX_CRYPTO_DEPOSIT_USD = 10_000;

export const DEFAULT_CREDIT_PRICE_USD = 2;

/** Bonus credits by USD deposit tier (whole dollars, inclusive ranges). */
export const DEPOSIT_BONUS_TIERS: ReadonlyArray<{
  fromUsd: number;
  toUsd: number;
  bonusCredits: number;
  label: string;
}> = [
  { fromUsd: 50, toUsd: 199, bonusCredits: 0, label: "$50–$199" },
  { fromUsd: 200, toUsd: 499, bonusCredits: 20, label: "$200–$499" },
  { fromUsd: 500, toUsd: 999, bonusCredits: 50, label: "$500–$999" },
  { fromUsd: 1000, toUsd: 1499, bonusCredits: 150, label: "$1,000–$1,499" },
  { fromUsd: 1500, toUsd: 2999, bonusCredits: 200, label: "$1,500–$2,999" },
  { fromUsd: 3000, toUsd: MAX_CRYPTO_DEPOSIT_USD, bonusCredits: 400, label: "$3,000–$10,000" },
];

/** Credit purchase lifecycle — proof must be submitted before status becomes pending. */
export const CREDIT_PURCHASE_STATUS = {
  AWAITING_PROOF: "awaiting_proof",
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
} as const;

export type CreditPurchaseStatus = (typeof CREDIT_PURCHASE_STATUS)[keyof typeof CREDIT_PURCHASE_STATUS];

export type CryptoPaymentMethod = "USDT_ETH" | "USDT_BNB";

export const CRYPTO_PAYMENT_METHODS: Array<{
  id: CryptoPaymentMethod;
  label: string;
  network: string;
  qrPath: string;
}> = [
  {
    id: "USDT_ETH",
    label: "USDT (ERC20)",
    network: "Ethereum network",
    qrPath: "/assets/payments/usdt-ethereum.jpg",
  },
  {
    id: "USDT_BNB",
    label: "USDT (BEP20)",
    network: "BNB Smart Chain",
    qrPath: "/assets/payments/usdt-bnb.jpg",
  },
];

export function parseCryptoPaymentMethod(raw: unknown): CryptoPaymentMethod | null {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (s === "USDT_ETH" || s === "USDT_ETHEREUM" || s === "USDT_ERC20" || s === "USDT_ETHERUM") {
    return "USDT_ETH";
  }
  if (s === "USDT_BNB" || s === "USDT_BSC" || s === "USDT_BEP20") return "USDT_BNB";
  return null;
}

export function cryptoPaymentMeta(id: CryptoPaymentMethod) {
  return CRYPTO_PAYMENT_METHODS.find((m) => m.id === id)!;
}

export function creditsForUsd(amountUsd: number, creditPriceUsd: number): number {
  const price = creditPriceUsd > 0 ? creditPriceUsd : DEFAULT_CREDIT_PRICE_USD;
  return Math.floor(amountUsd / price);
}

/** Bonus credits for a USD deposit tier (0 below $200). */
export function depositBonusCredits(amountUsd: number): number {
  for (const tier of DEPOSIT_BONUS_TIERS) {
    if (amountUsd >= tier.fromUsd && amountUsd <= tier.toUsd) return tier.bonusCredits;
  }
  return 0;
}

export function totalCreditsForDeposit(amountUsd: number, creditPriceUsd: number): number {
  return creditsForUsd(amountUsd, creditPriceUsd) + depositBonusCredits(amountUsd);
}

/** Deposit must be whole USD and an exact multiple of the per-credit price (e.g. $24 = 12 × $2). */
export function validateCryptoDepositUsd(
  amountUsdRaw: number,
  creditPriceUsd: number,
  minDeposit: number,
): { ok: true; amountUsd: number; credits: number; baseCredits: number; bonusCredits: number } | { ok: false; error: string } {
  if (!Number.isFinite(amountUsdRaw)) {
    return { ok: false, error: "Enter a valid USD amount." };
  }
  if (amountUsdRaw !== Math.floor(amountUsdRaw)) {
    return { ok: false, error: "Whole dollars only — no cents (e.g. $50, not $50.50)." };
  }

  const price = creditPriceUsd > 0 ? creditPriceUsd : DEFAULT_CREDIT_PRICE_USD;
  const amountUsd = Math.floor(amountUsdRaw);

  if (amountUsd > MAX_CRYPTO_DEPOSIT_USD) {
    return { ok: false, error: `Maximum crypto deposit is $${MAX_CRYPTO_DEPOSIT_USD.toLocaleString("en-US")} USD` };
  }
  if (amountUsd < minDeposit) {
    return { ok: false, error: `Minimum crypto deposit is $${Math.floor(minDeposit)} USD` };
  }
  if (amountUsd % price !== 0) {
    return {
      ok: false,
      error: `Amount must divide evenly into $${price} credits — e.g. $24 = 12 retrieves; $25 is not valid`,
    };
  }

  const baseCredits = amountUsd / price;
  if (baseCredits < 1) {
    const minValid = Math.ceil(minDeposit / price) * price;
    return {
      ok: false,
      error: `Amount too low — minimum $${minValid} (${minValid / price} credits at $${price}/credit)`,
    };
  }

  const bonusCredits = depositBonusCredits(amountUsd);
  const credits = baseCredits + bonusCredits;
  return { ok: true, amountUsd, credits, baseCredits, bonusCredits };
}
