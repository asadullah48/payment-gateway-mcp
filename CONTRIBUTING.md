# Contributing

Thank you for helping improve this project. Contributions of all kinds are welcome — bug fixes, new gateways, documentation, and tests.

## Getting Started

```bash
git clone https://github.com/asadullah48/payment-gateway-mcp.git
cd payment-gateway-mcp
npm install
cp .env.example .env   # fill in at least one gateway's credentials
npm run build          # compile TypeScript
npm run dev            # start with hot-reload (tsx watch)
```

## Adding a New Gateway

1. **Create** `src/gateways/yourgateway.ts` extending `BasePaymentGateway`:

```ts
import { BasePaymentGateway } from './base-gateway.js';
import { PaymentRequest, PaymentResponse, TransactionStatus, RefundResponse, GatewayConfig } from '../types.js';

export class YourGateway extends BasePaymentGateway {
  name = 'yourgateway';
  config: GatewayConfig = { ... };

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> { ... }
  async inquireTransaction(transactionId: string): Promise<TransactionStatus> { ... }
  async refundTransaction(transactionId: string, amount?: number): Promise<RefundResponse> { ... }
  getConfig(): GatewayConfig { return this.config; }
}
```

2. **Register** it in `src/index.ts` — add an entry to the `candidates` array in `buildRegistry()`:

```ts
{
  gateway: new YourGateway(),
  requiredEnvVars: ['YOUR_GATEWAY_KEY', 'YOUR_GATEWAY_SECRET']
}
```

3. **Update types** — add the gateway name to the `GatewayName` union in `src/types.ts`.

4. **Update `.env.example`** with the required env vars and placeholder values.

5. **Update `README.md`** — add a row to the gateway table and a configuration section.

## Development Tips

- Run `npm run typecheck` before committing — catches TypeScript errors without building
- Use `npm run dev` (tsx watch) for instant reload during development
- All gateway classes must implement the three core methods: `createPayment`, `inquireTransaction`, `refundTransaction`
- If a gateway does not support a feature (e.g., programmatic refunds), return `{ success: false, message: '...' }` with a clear explanation — do not throw

## Pull Request Guidelines

- Keep PRs focused — one gateway or one fix per PR
- Fill out the PR template
- Ensure `npm run build` passes with no errors
- Update `.env.example` and `README.md` if you add new configuration

## Reporting Issues

Use the [issue tracker](https://github.com/asadullah48/payment-gateway-mcp/issues). For gateway-specific bugs, include:
- Which gateway
- Sandbox or production environment
- The error message or unexpected response (redact any credentials)

## Code Style

- TypeScript strict mode is enforced
- Avoid `any` types — use `unknown` with type narrowing instead
- Gateway credentials must always be read from env vars — never hardcoded
- Error messages should be human-readable and actionable
