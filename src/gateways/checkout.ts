import axios from 'axios';
import { BasePaymentGateway } from './base-gateway.js';
import { PaymentRequest, PaymentResponse, TransactionStatus, RefundResponse, GatewayConfig } from '../types.js';
import { generateTransactionId } from '../signature.js';

// Checkout.com — international gateway that accepts Pakistani merchants (PKR + USD + multi-currency)
export class CheckoutGateway extends BasePaymentGateway {
  name = 'checkout';

  config: GatewayConfig = {
    name: 'checkout',
    isActive: true,
    supportedCurrencies: ['PKR', 'USD', 'EUR', 'GBP', 'AED'],
    minAmount: 0.5,
    maxAmount: 999999,
    environment: (process.env.CHECKOUT_ENV as 'sandbox' | 'production') || 'sandbox'
  };

  private apiEndpoints = {
    sandbox: {
      payments: 'https://api.sandbox.checkout.com/payments'
    },
    production: {
      payments: 'https://api.checkout.com/payments'
    }
  };

  private getCredentials() {
    return {
      secretKey: process.env.CHECKOUT_SECRET_KEY
    };
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    try {
      const creds = this.getCredentials();
      if (!creds.secretKey) {
        throw new Error('Checkout.com credentials not configured');
      }

      const transactionId = generateTransactionId('CKO');
      const currency = request.currency || 'USD';
      // Checkout.com requires amount in minor units (cents / paisa)
      const amountMinorUnits = Math.round(request.amount * 100);
      const endpoint = this.apiEndpoints[this.config.environment].payments;

      const payload = {
        amount: amountMinorUnits,
        currency,
        reference: request.orderId,
        description: `Order ${request.orderId}`,
        customer: {
          email: request.customerInfo?.email,
          name: request.customerInfo?.name
        },
        '3ds': { enabled: true },
        success_url: request.returnUrl || process.env.CHECKOUT_SUCCESS_URL || 'https://example.com/success',
        failure_url: process.env.CHECKOUT_FAILURE_URL || 'https://example.com/failure',
        metadata: { merchant_transaction_id: transactionId }
      };

      const response = await axios.post(endpoint, payload, {
        headers: {
          Authorization: `Bearer ${creds.secretKey}`,
          'Content-Type': 'application/json'
        }
      });

      const data = response.data;
      const isSuccess = data?.status === 'Pending' || data?.status === 'Authorized';
      const redirectUrl = data?._links?.redirect?.href;

      return {
        success: isSuccess,
        transactionId: isSuccess ? transactionId : undefined,
        redirectUrl,
        paymentData: {
          gatewayPaymentId: data?.id,
          status: data?.status,
          redirectUrl
        },
        error: isSuccess ? undefined : (data?.error_codes?.join(', ') || 'Checkout.com payment creation failed')
      };
    } catch (error) {
      this.logError('Failed to create Checkout.com payment', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async inquireTransaction(transactionId: string): Promise<TransactionStatus> {
    try {
      const creds = this.getCredentials();
      const endpoint = this.apiEndpoints[this.config.environment].payments;

      const response = await axios.get(`${endpoint}/${transactionId}`, {
        headers: { Authorization: `Bearer ${creds.secretKey}` }
      });

      const data = response.data;
      const statusMap: Record<string, 'pending' | 'success' | 'failed' | 'refunded'> = {
        Authorized: 'success',
        Captured: 'success',
        Paid: 'success',
        Pending: 'pending',
        Declined: 'failed',
        Expired: 'failed',
        Canceled: 'failed',
        Refunded: 'refunded',
        'Partially Refunded': 'refunded'
      };

      return {
        status: statusMap[data?.status] || 'failed',
        amount: (data?.amount || 0) / 100,
        currency: data?.currency || 'USD',
        gatewayTransactionId: data?.id || transactionId,
        errorMessage: data?.status === 'Declined' ? 'Payment declined by card issuer' : undefined
      };
    } catch (error) {
      this.logError('Checkout.com inquiry failed', error);
      throw error;
    }
  }

  async refundTransaction(transactionId: string, amount?: number): Promise<RefundResponse> {
    try {
      const creds = this.getCredentials();
      const endpoint = this.apiEndpoints[this.config.environment].payments;

      const payload: Record<string, any> = {};
      if (amount !== undefined) {
        payload.amount = Math.round(amount * 100);
      }

      // Checkout.com refund returns 202 Accepted on success
      const response = await axios.post(`${endpoint}/${transactionId}/refunds`, payload, {
        headers: {
          Authorization: `Bearer ${creds.secretKey}`,
          'Content-Type': 'application/json'
        }
      });

      const isSuccess = response.status === 202;

      return {
        success: isSuccess,
        refundId: response.data?.action_id,
        amount,
        message: isSuccess ? 'Refund initiated successfully' : 'Refund request failed'
      };
    } catch (error) {
      this.logError('Checkout.com refund failed', error);
      return { success: false, message: error instanceof Error ? error.message : 'Refund failed' };
    }
  }

  getConfig(): GatewayConfig {
    return this.config;
  }
}
