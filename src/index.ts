import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { JazzCashGateway } from './gateways/jazzcash.js';
import { EasypaisaGateway } from './gateways/easypaisa.js';
import { NayapayGateway } from './gateways/nayapay.js';
import { MeezanGateway } from './gateways/meezan.js';
import { AlfalahGateway } from './gateways/alfalah.js';
import { CheckoutGateway } from './gateways/checkout.js';
import { IPaymentGateway } from './gateways/base-gateway.js';
import { PaymentRequest } from './types.js';
import dotenv from 'dotenv';

dotenv.config();

// Only register gateways whose required credentials are present
function buildRegistry(): Map<string, IPaymentGateway> {
  const registry = new Map<string, IPaymentGateway>();

  const candidates: Array<{ gateway: IPaymentGateway; requiredEnvVars: string[] }> = [
    {
      gateway: new JazzCashGateway(),
      requiredEnvVars: ['JAZZCASH_MERCHANT_ID', 'JAZZCASH_PASSWORD', 'JAZZCASH_INTEGRITY_SALT']
    },
    {
      gateway: new EasypaisaGateway(),
      requiredEnvVars: ['EASYPAISA_STORE_ID', 'EASYPAISA_HASH_KEY']
    },
    {
      gateway: new NayapayGateway(),
      requiredEnvVars: ['NAYAPAY_CLIENT_ID', 'NAYAPAY_CLIENT_SECRET']
    },
    {
      gateway: new MeezanGateway(),
      requiredEnvVars: ['MEEZAN_MERCHANT_ID', 'MEEZAN_PASSWORD', 'MEEZAN_INTEGRITY_SALT']
    },
    {
      gateway: new AlfalahGateway(),
      requiredEnvVars: ['ALFALAH_MERCHANT_ID', 'ALFALAH_MERCHANT_KEY']
    },
    {
      gateway: new CheckoutGateway(),
      requiredEnvVars: ['CHECKOUT_SECRET_KEY']
    }
  ];

  for (const { gateway, requiredEnvVars } of candidates) {
    const isConfigured = requiredEnvVars.every(v => !!process.env[v]);
    if (isConfigured) {
      registry.set(gateway.name, gateway);
      console.error(`[registry] ${gateway.name} registered`);
    } else {
      const missing = requiredEnvVars.filter(v => !process.env[v]);
      console.error(`[registry] ${gateway.name} skipped (missing: ${missing.join(', ')})`);
    }
  }

  return registry;
}

const gateways = buildRegistry();
const activeGatewayNames = Array.from(gateways.keys());

const server = new Server(
  { name: 'payment-gateway-mcp', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_gateways',
      description: 'List all configured and active payment gateways with their supported currencies and limits',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'create_payment',
      description: 'Initiate a payment through a specified gateway. Returns redirect URL or payment form data.',
      inputSchema: {
        type: 'object',
        properties: {
          gateway: {
            type: 'string',
            enum: activeGatewayNames,
            description: 'Payment gateway to use'
          },
          amount: { type: 'number', description: 'Payment amount (PKR for local gateways)' },
          currency: { type: 'string', description: 'Currency code (default: PKR)', default: 'PKR' },
          orderId: { type: 'string', description: 'Your unique order/reference ID' },
          customerInfo: {
            type: 'object',
            description: 'Optional customer details',
            properties: {
              name: { type: 'string' },
              email: { type: 'string' },
              phone: { type: 'string', description: 'Required for EasyPaisa MA (mobile account) payments' }
            }
          },
          returnUrl: { type: 'string', description: 'URL to redirect after payment completion' }
        },
        required: ['gateway', 'amount', 'orderId']
      }
    },
    {
      name: 'check_payment',
      description: 'Check the status of an existing payment transaction',
      inputSchema: {
        type: 'object',
        properties: {
          gateway: { type: 'string', enum: activeGatewayNames },
          transactionId: { type: 'string', description: 'Transaction ID returned by create_payment' }
        },
        required: ['gateway', 'transactionId']
      }
    },
    {
      name: 'refund_payment',
      description: 'Refund a completed payment (full or partial)',
      inputSchema: {
        type: 'object',
        properties: {
          gateway: { type: 'string', enum: activeGatewayNames },
          transactionId: { type: 'string' },
          amount: { type: 'number', description: 'Refund amount — omit for full refund' }
        },
        required: ['gateway', 'transactionId']
      }
    },
    {
      name: 'get_gateway_details',
      description: 'Get configuration details for a specific gateway (currencies, limits, environment)',
      inputSchema: {
        type: 'object',
        properties: {
          gateway: { type: 'string', enum: activeGatewayNames }
        },
        required: ['gateway']
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const getGateway = (gatewayName: unknown) => {
    const gateway = gateways.get(String(gatewayName));
    if (!gateway) {
      throw new Error(
        `Gateway '${gatewayName}' is not configured. Active gateways: ${activeGatewayNames.join(', ') || 'none'}`
      );
    }
    return gateway;
  };

  switch (name) {
    case 'list_gateways': {
      const list = Array.from(gateways.entries()).map(([_key, gw]) => gw.getConfig());
      return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
    }

    case 'create_payment': {
      const gateway = getGateway(args?.gateway);
      const paymentRequest: PaymentRequest = {
        gateway: args?.gateway as PaymentRequest['gateway'],
        amount: Number(args?.amount),
        currency: String(args?.currency || 'PKR'),
        orderId: String(args?.orderId),
        customerInfo: (args?.customerInfo as PaymentRequest['customerInfo']) || {},
        returnUrl: args?.returnUrl ? String(args.returnUrl) : undefined
      };
      const result = await gateway.createPayment(paymentRequest);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'check_payment': {
      const gateway = getGateway(args?.gateway);
      const result = await gateway.inquireTransaction(String(args?.transactionId));
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'refund_payment': {
      const gateway = getGateway(args?.gateway);
      const amount = args?.amount !== undefined ? Number(args.amount) : undefined;
      const result = await gateway.refundTransaction(String(args?.transactionId), amount);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'get_gateway_details': {
      const gateway = getGateway(args?.gateway);
      return { content: [{ type: 'text', text: JSON.stringify(gateway.getConfig(), null, 2) }] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Payment Gateway MCP v2.0 — active: [${activeGatewayNames.join(', ') || 'none configured'}]`);
}

main().catch(console.error);
