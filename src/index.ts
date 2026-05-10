import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { JazzCashGateway } from './gateways/jazzcash.js';
import { PaymentRequest } from './types.js';
import dotenv from 'dotenv';

dotenv.config();

const gateways = new Map();
const jazzcash = new JazzCashGateway();
gateways.set('jazzcash', jazzcash);

const server = new Server(
  { name: 'payment-gateway-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'create_payment',
      description: 'Create payment through specified gateway',
      inputSchema: {
        type: 'object',
        properties: {
          gateway: { type: 'string', enum: ['jazzcash'] },
          amount: { type: 'number' },
          currency: { type: 'string', default: 'PKR' },
          orderId: { type: 'string' },
          customerName: { type: 'string' },
          customerEmail: { type: 'string' },
          customerPhone: { type: 'string' },
          returnUrl: { type: 'string' }
        },
        required: ['gateway', 'amount', 'orderId']
      }
    },
    {
      name: 'check_payment',
      description: 'Check payment status',
      inputSchema: {
        type: 'object',
        properties: {
          gateway: { type: 'string', enum: ['jazzcash'] },
          transactionId: { type: 'string' }
        },
        required: ['gateway', 'transactionId']
      }
    },
    {
      name: 'refund_payment',
      description: 'Refund a payment',
      inputSchema: {
        type: 'object',
        properties: {
          gateway: { type: 'string', enum: ['jazzcash'] },
          transactionId: { type: 'string' },
          amount: { type: 'number' }
        },
        required: ['gateway', 'transactionId']
      }
    },
    {
      name: 'list_gateways',
      description: 'List available gateways',
      inputSchema: { type: 'object', properties: {} }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'create_payment': {
      const gateway = gateways.get(args?.gateway);
      const result = await gateway.createPayment(args as PaymentRequest);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'check_payment': {
      const gateway = gateways.get(args?.gateway);
      const result = await gateway.inquireTransaction(args?.transactionId);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'refund_payment': {
      const gateway = gateways.get(args?.gateway);
      const result = await gateway.refundTransaction(args?.transactionId, args?.amount);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'list_gateways': {
      const list = Array.from(gateways.keys());
      return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Payment Gateway MCP Server running');
}

main().catch(console.error);