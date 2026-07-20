// High-value brand domains for typosquat detection.
// Deliberately mixes global targets with Nigerian/African banks & fintech —
// scam targeting is regional, and this list is a genuine differentiator.
//
// Each entry is the registrable domain (eTLD+1) of the legitimate brand.
// `label` is the plain-language brand name used in evidence detail strings.

export interface Brand {
  domain: string;
  label: string;
}

export const BRANDS: Brand[] = [
  // ---- Global tech / platforms ----
  { domain: "paypal.com", label: "PayPal" },
  { domain: "apple.com", label: "Apple" },
  { domain: "icloud.com", label: "iCloud" },
  { domain: "google.com", label: "Google" },
  { domain: "gmail.com", label: "Gmail" },
  { domain: "microsoft.com", label: "Microsoft" },
  { domain: "outlook.com", label: "Outlook" },
  { domain: "office.com", label: "Microsoft Office" },
  { domain: "live.com", label: "Microsoft Live" },
  { domain: "amazon.com", label: "Amazon" },
  { domain: "netflix.com", label: "Netflix" },
  { domain: "meta.com", label: "Meta" },
  { domain: "facebook.com", label: "Facebook" },
  { domain: "instagram.com", label: "Instagram" },
  { domain: "whatsapp.com", label: "WhatsApp" },
  { domain: "linkedin.com", label: "LinkedIn" },
  { domain: "twitter.com", label: "Twitter" },
  { domain: "x.com", label: "X" },
  { domain: "youtube.com", label: "YouTube" },
  { domain: "tiktok.com", label: "TikTok" },
  { domain: "dropbox.com", label: "Dropbox" },
  { domain: "adobe.com", label: "Adobe" },
  { domain: "docusign.com", label: "DocuSign" },
  { domain: "yahoo.com", label: "Yahoo" },
  { domain: "spotify.com", label: "Spotify" },
  { domain: "ebay.com", label: "eBay" },
  { domain: "walmart.com", label: "Walmart" },
  { domain: "fedex.com", label: "FedEx" },
  { domain: "ups.com", label: "UPS" },
  { domain: "usps.com", label: "USPS" },
  { domain: "dhl.com", label: "DHL" },

  // ---- Global banks / payments / cards ----
  { domain: "chase.com", label: "Chase" },
  { domain: "bankofamerica.com", label: "Bank of America" },
  { domain: "wellsfargo.com", label: "Wells Fargo" },
  { domain: "citibank.com", label: "Citibank" },
  { domain: "citi.com", label: "Citi" },
  { domain: "hsbc.com", label: "HSBC" },
  { domain: "barclays.co.uk", label: "Barclays" },
  { domain: "americanexpress.com", label: "American Express" },
  { domain: "visa.com", label: "Visa" },
  { domain: "mastercard.com", label: "Mastercard" },
  { domain: "wise.com", label: "Wise" },
  { domain: "venmo.com", label: "Venmo" },
  { domain: "cash.app", label: "Cash App" },
  { domain: "zellepay.com", label: "Zelle" },
  { domain: "stripe.com", label: "Stripe" },
  { domain: "revolut.com", label: "Revolut" },

  // ---- Crypto / exchanges / wallets ----
  { domain: "okx.com", label: "OKX" },
  { domain: "binance.com", label: "Binance" },
  { domain: "coinbase.com", label: "Coinbase" },
  { domain: "kraken.com", label: "Kraken" },
  { domain: "crypto.com", label: "Crypto.com" },
  { domain: "bybit.com", label: "Bybit" },
  { domain: "kucoin.com", label: "KuCoin" },
  { domain: "metamask.io", label: "MetaMask" },
  { domain: "trustwallet.com", label: "Trust Wallet" },
  { domain: "ledger.com", label: "Ledger" },
  { domain: "trezor.io", label: "Trezor" },
  { domain: "blockchain.com", label: "Blockchain.com" },
  { domain: "bitcoin.org", label: "Bitcoin.org" },
  { domain: "uniswap.org", label: "Uniswap" },
  { domain: "phantom.app", label: "Phantom" },

  // ---- Nigerian / African banks ----
  { domain: "gtbank.com", label: "GTBank" },
  { domain: "accessbankplc.com", label: "Access Bank" },
  { domain: "zenithbank.com", label: "Zenith Bank" },
  { domain: "firstbanknigeria.com", label: "First Bank Nigeria" },
  { domain: "ubagroup.com", label: "UBA" },
  { domain: "fidelitybank.ng", label: "Fidelity Bank" },
  { domain: "fcmb.com", label: "FCMB" },
  { domain: "stanbicibtc.com", label: "Stanbic IBTC" },
  { domain: "unionbankng.com", label: "Union Bank Nigeria" },
  { domain: "ecobank.com", label: "Ecobank" },
  { domain: "wemabank.com", label: "Wema Bank" },
  { domain: "polarisbanklimited.com", label: "Polaris Bank" },
  { domain: "sterling.ng", label: "Sterling Bank" },
  { domain: "keystonebankng.com", label: "Keystone Bank" },
  { domain: "providusbank.com", label: "Providus Bank" },

  // ---- Nigerian / African fintech ----
  { domain: "kuda.com", label: "Kuda" },
  { domain: "opay-inc.com", label: "OPay" },
  { domain: "opayweb.com", label: "OPay" },
  { domain: "palmpay.com", label: "PalmPay" },
  { domain: "moniepoint.com", label: "Moniepoint" },
  { domain: "flutterwave.com", label: "Flutterwave" },
  { domain: "paystack.com", label: "Paystack" },
  { domain: "interswitchgroup.com", label: "Interswitch" },
  { domain: "remita.net", label: "Remita" },
  { domain: "nibss-plc.com.ng", label: "NIBSS" },
  { domain: "carbon.ng", label: "Carbon" },
  { domain: "fairmoney.io", label: "FairMoney" },
  { domain: "piggyvest.com", label: "PiggyVest" },
  { domain: "cowrywise.com", label: "Cowrywise" },
  { domain: "chippercash.com", label: "Chipper Cash" },
  { domain: "bamboo.com", label: "Bamboo" },
  { domain: "risevest.com", label: "Rise" },

  // ---- African telecom (common airtime/data phishing) ----
  { domain: "mtn.ng", label: "MTN Nigeria" },
  { domain: "mtn.com", label: "MTN" },
  { domain: "airtel.com.ng", label: "Airtel Nigeria" },
  { domain: "gloworld.com", label: "Glo" },
  { domain: "9mobile.com.ng", label: "9mobile" },
  { domain: "safaricom.co.ke", label: "Safaricom" },
  { domain: "mpesa.com", label: "M-Pesa" },

  // ---- Nigerian gov / identity (frequent scam impersonation) ----
  { domain: "nimc.gov.ng", label: "NIMC" },
  { domain: "firs.gov.ng", label: "FIRS" },
  { domain: "cbn.gov.ng", label: "Central Bank of Nigeria" },
  { domain: "npc.gov.ng", label: "National Population Commission" },
  { domain: "jamb.gov.ng", label: "JAMB" },
];

/** Fast lookup set of exact legitimate registrable domains. */
export const BRAND_DOMAIN_SET = new Set(BRANDS.map((b) => b.domain));

/**
 * The "core" brand token (portion before the first dot of the registrable
 * domain), used for substring-containment checks like `paypal-secure.com`.
 * Only tokens length >= 4 to avoid noisy matches ("uba", "glo" handled by
 * exact/levenshtein paths, not containment).
 */
export interface BrandToken {
  token: string;
  brand: Brand;
}

export const BRAND_TOKENS: BrandToken[] = BRANDS.map((b) => ({
  token: b.domain.split(".")[0],
  brand: b,
})).filter((t) => t.token.length >= 5);
