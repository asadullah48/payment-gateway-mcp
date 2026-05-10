import { IPaymentGateway } from './gateways/base-gateway.js';
import { GatewayName, RoutingContext, RoutingDecision } from './types.js';

// Default priority for PKR gateways — lower index = higher base priority
const PKR_PRIORITY: GatewayName[] = ['jazzcash', 'easypaisa', 'nayapay', 'meezan', 'alfalah'];

const LARGE_AMOUNT_THRESHOLD_PKR = 200_000;

/**
 * Selects and ranks gateways for a payment request.
 * Returns a primary gateway and an ordered fallback chain.
 * Throws if no eligible gateway is available.
 */
export function selectGateway(
  ctx: RoutingContext,
  available: Map<string, IPaymentGateway>
): RoutingDecision {
  const { amount, currency, hasPhone } = ctx;
  const reasons: string[] = [];

  // Step 1 — filter by currency support
  let eligible = Array.from(available.values()).filter(gw =>
    gw.getConfig().supportedCurrencies.includes(currency)
  );

  if (eligible.length === 0) {
    throw new Error(`No configured gateway supports currency: ${currency}`);
  }

  if (currency !== 'PKR') {
    reasons.push(`Currency is ${currency} — only international gateways are eligible`);
    eligible = eligible.filter(gw => gw.name === 'checkout');
    if (eligible.length === 0) {
      throw new Error(`No international gateway configured. Add CHECKOUT_SECRET_KEY to .env to enable Checkout.com`);
    }
  }

  // Step 2 — filter by amount range
  const beforeAmountFilter = eligible.length;
  eligible = eligible.filter(gw => {
    const { minAmount, maxAmount } = gw.getConfig();
    return amount >= minAmount && amount <= maxAmount;
  });

  if (eligible.length === 0) {
    const ranges = Array.from(available.values())
      .filter(gw => gw.getConfig().supportedCurrencies.includes(currency))
      .map(gw => {
        const { minAmount, maxAmount } = gw.getConfig();
        return `${gw.name} (${minAmount}–${maxAmount})`;
      });
    throw new Error(
      `Amount ${amount} ${currency} is outside all configured gateway limits. ` +
      `Configured ranges: ${ranges.join(', ')}`
    );
  }

  if (eligible.length < beforeAmountFilter) {
    reasons.push(`Amount ${amount.toLocaleString()} ${currency} filtered out some gateways outside their limits`);
  }

  // Step 3 — score each eligible gateway
  const scored = eligible.map(gw => {
    const name = gw.name as GatewayName;
    let score = 0;

    // Base priority from default PKR order
    const rank = PKR_PRIORITY.indexOf(name);
    if (rank !== -1) {
      score += (PKR_PRIORITY.length - rank) * 10;
    }

    // Phone available → EasyPaisa MA is better UX than OTC or redirects
    if (hasPhone && name === 'easypaisa') score += 30;

    // Large PKR amount → prefer banks with higher ceilings
    if (currency === 'PKR' && amount > LARGE_AMOUNT_THRESHOLD_PKR) {
      if (name === 'alfalah' || name === 'meezan') score += 20;
      if (name === 'jazzcash' || name === 'easypaisa') score -= 15;
    }

    // International: checkout wins unconditionally for non-PKR
    if (currency !== 'PKR' && name === 'checkout') score += 1000;

    return { name, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const primary = scored[0].name;
  const fallbackChain = scored.slice(1).map(s => s.name);

  // Build human-readable reasoning
  if (currency !== 'PKR') {
    reasons.push(`${primary} selected — only gateway supporting ${currency}`);
  } else if (hasPhone && primary === 'easypaisa') {
    reasons.push('easypaisa selected — customer phone enables mobile account (MA) payment');
  } else if (amount > LARGE_AMOUNT_THRESHOLD_PKR) {
    reasons.push(`Large amount (PKR ${amount.toLocaleString()}) — bank gateway preferred for higher limit`);
    reasons.push(`${primary} selected as highest-scoring bank gateway`);
  } else {
    reasons.push(`${primary} selected as highest-priority configured gateway for ${currency}`);
  }

  if (fallbackChain.length > 0) {
    reasons.push(`Fallback order if primary fails: ${fallbackChain.join(' → ')}`);
  } else {
    reasons.push('No fallback gateways available for this amount/currency combination');
  }

  return { primary, fallbackChain, reasons };
}
