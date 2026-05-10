# payment-gateway-mcp

A unified [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that gives Claude native access to Pakistani and international payment gateways — JazzCash, EasyPaisa, Naya Pay, Meezan Bank, Bank Alfalah, and Checkout.com.


---

## Supported Gateways

| Gateway | Type | Currencies | Auth |
|---|---|---|---|
| **JazzCash** | Mobile wallet | PKR | HMAC-SHA256 |
| **EasyPaisa** | Mobile wallet | PKR | HMAC-SHA1 |
| **Naya Pay** | Digital bank | PKR | OAuth2 Bearer |
| **Meezan Bank** | Islamic bank | PKR | HMAC-SHA256 |
| **Bank Alfalah** | Commercial bank | PKR, USD | HMAC-SHA256 |
| **Checkout.com** | International | PKR, USD, EUR, GBP, AED | Bearer + 3DS |

All gateways use **hosted checkout** — customers are redirected to the gateway's own payment page. No PCI-DSS scope required on your server.

---

## Prerequisites

- Node.js 18+
- [Claude Code](https://claude.ai/code) CLI

---

## Installation

```bash
git clone https://github.com/asadullah48/payment-gateway-mcp.git
cd payment-gateway-mcp
npm install
npm run build
```

---

## Configuration

Copy `.env.example` to `.env` and fill in credentials for the gateways you have access to. **Only gateways with all required credentials will be registered** — you do not need all six.

```bash
cp .env.example .env
```

### JazzCash
Get credentials from the [JazzCash Merchant Portal](https://payments.jazzcash.com.pk).
```env
JAZZCASH_MERCHANT_ID=MC12345678
JAZZCASH_PASSWORD=your_password
JAZZCASH_INTEGRITY_SALT=your_salt
JAZZCASH_ENV=sandbox          # or production
JAZZCASH_RETURN_URL=https://yourdomain.com/callback/jazzcash
```

### EasyPaisa
Get credentials from the [EasyPaisa Merchant Portal](https://easypay.easypaisa.com.pk).
```env
EASYPAISA_STORE_ID=STORE123456
EASYPAISA_HASH_KEY=your_hash_key
EASYPAISA_ENV=sandbox
EASYPAISA_RETURN_URL=https://yourdomain.com/callback/easypaisa
```

### Naya Pay
Get credentials from [Naya Pay Business](https://nayapay.com/business).
```env
NAYAPAY_CLIENT_ID=your_client_id
NAYAPAY_CLIENT_SECRET=your_client_secret
NAYAPAY_ENV=sandbox
NAYAPAY_RETURN_URL=https://yourdomain.com/callback/nayapay
```

### Meezan Bank
Get credentials from [Meezan Bank Business](https://www.meezanbank.com/business).
```env
MEEZAN_MERCHANT_ID=MEZ123456
MEEZAN_PASSWORD=your_password
MEEZAN_INTEGRITY_SALT=your_salt
MEEZAN_ENV=sandbox
MEEZAN_RETURN_URL=https://yourdomain.com/callback/meezan
```

### Bank Alfalah
Get credentials from the [Alfalah BAFT Portal](https://www.bankalfalah.com/business).
```env
ALFALAH_MERCHANT_ID=AF123456
ALFALAH_MERCHANT_KEY=your_merchant_key
ALFALAH_CHANNEL_ID=1001
ALFALAH_ENV=sandbox
ALFALAH_RETURN_URL=https://yourdomain.com/callback/alfalah
```

### Checkout.com (International)
Get credentials from the [Checkout.com Hub](https://hub.checkout.com).
```env
CHECKOUT_SECRET_KEY=sk_sbox_xxxxxxxxxxxxxxxx
CHECKOUT_PUBLIC_KEY=pk_sbox_xxxxxxxxxxxxxxxx
CHECKOUT_ENV=sandbox
CHECKOUT_SUCCESS_URL=https://yourdomain.com/payment/success
CHECKOUT_FAILURE_URL=https://yourdomain.com/payment/failure
```

---

## Adding to Claude Code

```bash
# macOS / Linux
claude mcp add payment-gateway -- node /path/to/payment-gateway-mcp/dist/index.js

# Windows (Git Bash / WSL-style path)
claude mcp add payment-gateway -- node /d/payment-gateway-mcp/dist/index.js

# Windows (native path)
claude mcp add payment-gateway -- node "D:\payment-gateway-mcp\dist\index.js"
```

Or add manually to your Claude Code `settings.json`:
```json
{
  "mcpServers": {
    "payment-gateway": {
      "command": "node",
      "args": ["/path/to/payment-gateway-mcp/dist/index.js"]
    }
  }
}
```

Verify the server is connected:
```bash
claude mcp list
```

---

## MCP Tools

Once connected, Claude can call these tools directly in conversation:

### `list_gateways`
Lists all active (configured) gateways with their limits and supported currencies.

### `create_payment`
Initiates a payment. Returns a redirect URL or POST form data to send the customer to the gateway's payment page.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `gateway` | string | yes | `jazzcash`, `easypaisa`, `nayapay`, `meezan`, `alfalah`, `checkout` |
| `amount` | number | yes | PKR for local gateways |
| `orderId` | string | yes | Your unique order reference |
| `currency` | string | no | Defaults to `PKR` |
| `customerInfo.name` | string | no | |
| `customerInfo.email` | string | no | |
| `customerInfo.phone` | string | no | Required for EasyPaisa MA (mobile account) payments |
| `returnUrl` | string | no | Overrides the env var default |

### `check_payment`
Checks transaction status. Returns `pending | success | failed | refunded`.

| Parameter | Type | Required |
|---|---|---|
| `gateway` | string | yes |
| `transactionId` | string | yes |

### `refund_payment`
Initiates a full or partial refund.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `gateway` | string | yes | |
| `transactionId` | string | yes | |
| `amount` | number | no | Omit for full refund |

> **Note:** EasyPaisa does not expose a programmatic refund API. The tool returns instructions to use the merchant portal instead.

### `get_gateway_details`
Returns the configuration for a specific gateway (environment, amount limits, supported currencies).

---

## Gateway Notes

**EasyPaisa** supports two payment modes:
- **OTC (Over The Counter)** — customer pays cash at any EasyPaisa retailer shop. No phone number required.
- **MA (Mobile Account)** — direct wallet debit with customer approval. Requires `customerInfo.phone`.

**Checkout.com** is the recommended gateway for accepting international cards (Visa / Mastercard) as a Pakistani merchant. It supports PKR settlement alongside major foreign currencies.

**Meezan Bank** and **Bank Alfalah** use hosted checkout flows structurally identical to JazzCash — same HMAC-SHA256 signature scheme, different field prefixes (`pp_` vs `HS_`).

---

## How It Works

```
Claude Code  ──MCP──►  payment-gateway-mcp  ──HTTPS──►  Gateway API
                              │
                    Smart registry at startup:
                    only gateways with all required
                    env vars get registered
```

Each gateway extends a common `BasePaymentGateway` abstract class (Strategy Pattern). Adding a new gateway means one new file in `src/gateways/` and a single entry in the candidates array in `src/index.ts`.

---

## Project Structure

```
src/
  gateways/
    base-gateway.ts      # Abstract base + IPaymentGateway interface
    jazzcash.ts
    easypaisa.ts
    nayapay.ts
    meezan.ts
    alfalah.ts
    checkout.ts
  types.ts               # Shared TypeScript types
  signature.ts           # HMAC-SHA256 + HMAC-SHA1 utilities
  index.ts               # MCP server + smart registry
```

---

## Contributing

Pull requests welcome. To add a new gateway:

1. Create `src/gateways/yourgateway.ts` extending `BasePaymentGateway`
2. Add it to the `candidates` array in `src/index.ts`
3. Add its env vars to `.env.example`
4. Add the gateway name to the `GatewayName` union in `src/types.ts`

---

## Credits

- Built with the [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

---

## License

MIT
