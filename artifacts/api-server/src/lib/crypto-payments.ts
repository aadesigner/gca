/** USDT payment options shown in the client credits flow. */
export const CRYPTO_WALLET_ADDRESS = "0xf65fB66400C6F5e256f50b8C913026B6C2Ce56bF";

export const MIN_CRYPTO_DEPOSIT_USD = 40;

export const DEFAULT_CREDIT_PRICE_USD = 2;

export type CryptoPaymentMethod = "USDT_ETH" | "USDT_BNB";

export const CRYPTO_PAYMENT_METHODS: Array<{
  id: CryptoPaymentMethod;
  label: string;
  network: string;
  qrPath: string;
}> = [
  {
    id: "USDT_ETH",
    label: "USDT · Ethereum (ERC-20)",
    network: "Ethereum",
    qrPath: "/assets/payments/usdt-ethereum.jpg",
  },
  {
    id: "USDT_BNB",
    label: "USDT · BNB Smart Chain (BEP-20)",
    network: "BNB Chain",
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

/** Deposit must be whole USD and an exact multiple of the per-credit price (e.g. $24 = 12 × $2). */
export function validateCryptoDepositUsd(
  amountUsdRaw: number,
  creditPriceUsd: number,
  minDeposit: number,
): { ok: true; amountUsd: number; credits: number } | { ok: false; error: string } {
  if (!Number.isFinite(amountUsdRaw)) {
    return { ok: false, error: "Enter a valid USD amount." };
  }
  if (amountUsdRaw !== Math.floor(amountUsdRaw)) {
    return { ok: false, error: "Whole dollars only — no cents (e.g. $40, not $40.50)." };
  }

  const price = creditPriceUsd > 0 ? creditPriceUsd : DEFAULT_CREDIT_PRICE_USD;
  const amountUsd = Math.min(100_000, Math.floor(amountUsdRaw));

  if (amountUsd < minDeposit) {
    return { ok: false, error: `Minimum crypto deposit is $${Math.floor(minDeposit)} USD` };
  }
  if (amountUsd % price !== 0) {
    return {
      ok: false,
      error: `Amount must divide evenly into $${price} credits — e.g. $24 = 12 retrieves; $25 is not valid`,
    };
  }

  const credits = amountUsd / price;
  if (credits < 1) {
    const minValid = Math.ceil(minDeposit / price) * price;
    return {
      ok: false,
      error: `Amount too low — minimum $${minValid} (${minValid / price} credits at $${price}/credit)`,
    };
  }

  return { ok: true, amountUsd, credits };
}
