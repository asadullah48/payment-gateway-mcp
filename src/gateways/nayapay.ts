import axios from 'axios';
import { BasePaymentGateway } from './base-gateway.js';
import { PaymentRequest, PaymentResponse, TransactionStatus, RefundResponse, GatewayConfig } from '../types.js';
import { generateTransactionId } from '../signature.js';

export class NayapayGateway extends BasePaymentGateway {
  name = 'nayapay';

  config: GatewayConfig = {
    name: 'nayapay',
    isActive: true,
    supportedCurrencies: ['PKR'],
    minAmount: 1,
    maxAmount: 250000,
    environment: (process.env.NAYAPAY_ENV as 'sandbox' | 'production') || 'sandbox'
  };

  private apiEndpoints = {
    sandbox: {
      auth: 'https://sandbox.nayapay.com/api/v1/oauth/token',
      payment: 'https://sandbox.nayapay.com/api/v1/payment/create',
      inquiry: 'https://sandbox.nayapay.com/api/v1/payment/status',
      refund: 'https://sandbox.nayapay.com/api/v1/payment/refund'
    },
    production: {
      auth: 'https://api.nayapay.com/api/v1/oauth/token',
      payment: 'https://api.nayapay.com/api/v1/payment/create',
      inquiry: 'https://api.nayapay.com/api/v1/payment/status',
      refund: 'https://api.nayapay.com/api/v1/payment/refund'
    }
  };

  private getCredentials() {
    return {
      clientId: process.env.NAYAPAY_CLIENT_ID,
      clientSecret: process.env.NAYAPAY_CLIENT_SECRET
    };
  }

  private async getAccessToken(): Promise<string> {
    const creds = this.getCredentials();
    const endpoints = this.apiEndpoints[this.config.environment];

    const response = await axios.post(endpoints.auth, {
      grant_type: 'client_credentials',
      client_id: creds.clientId,
      client_secret: creds.clientSecret
    });

    return response.data.access_token;
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    try {
      const creds = this.getCredentials();
      if (!creds.clientId || !creds.clientSecret) {
        throw new Error('Naya Pay credentials not configured');
      }

      if (!this.validateAmount(request.amount)) {
        throw new Error(`Amount must be between ${this.config.minAmount} and ${this.config.maxAmount} PKR`);
      }

      const accessToken = await this.getAccessToken();
      const transactionId = generateTransactionId('NP');
      const endpoints = this.apiEndpoints[this.config.environment];

      const payload = {
        merchantTransactionId: transactionId,
        amount: request.amount,
        currency: request.currency || 'PKR',
        orderId: request.orderId,
        returnUrl: request.returnUrl || process.env.NAYAPAY_RETURN_URL || 'https://example.com/callback',
        customerEmail: request.customerInfo?.email,
        customerPhone: request.customerInfo?.phone,
        customerName: request.customerInfo?.name,
        description: `Payment for order ${request.orderId}`
      };

      const response = await axios.post(endpoints.payment, payload, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      const data = response.data;
      const isSuccess = data?.status === 'CREATED' || data?.success === true;

      return {
        success: isSuccess,
        transactionId: isSuccess ? transactionId : undefined,
        redirectUrl: isSuccess ? data?.paymentUrl : undefined,
        paymentData: {
          transactionId,
          gatewayRef: data?.paymentId,
          paymentUrl: data?.paymentUrl
        },
        error: isSuccess ? undefined : (data?.message || 'Naya Pay payment creation failed')
      };
    } catch (error) {
      this.logError('Failed to create Naya Pay payment', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async inquireTransaction(transactionId: string): Promise<TransactionStatus> {
    try {
      const accessToken = await this.getAccessToken();
      const endpoints = this.apiEndpoints[this.config.environment];

      const response = await axios.get(`${endpoints.inquiry}/${transactionId}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      const data = response.data;
      const statusMap: Record<string, 'pending' | 'success' | 'failed' | 'refunded'> = {
        COMPLETED: 'success',
        PAID: 'success',
        PENDING: 'pending',
        FAILED: 'failed',
        REFUNDED: 'refunded'
      };

      return {
        status: statusMap[data?.status] || 'failed',
        amount: data?.amount || 0,
        currency: data?.currency || 'PKR',
        gatewayTransactionId: data?.paymentId || transactionId,
        errorMessage: data?.errorMessage
      };
    } catch (error) {
      this.logError('Naya Pay inquiry failed', error);
      throw error;
    }
  }

  async refundTransaction(transactionId: string, amount?: number): Promise<RefundResponse> {
    try {
      const accessToken = await this.getAccessToken();
      const endpoints = this.apiEndpoints[this.config.environment];

      const payload: Record<string, any> = { transactionId };
      if (amount !== undefined) payload.amount = amount;

      const response = await axios.post(endpoints.refund, payload, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      const data = response.data;
      const isSuccess = data?.success === true || data?.status === 'REFUNDED';

      return {
        success: isSuccess,
        refundId: data?.refundId,
        amount,
        message: data?.message || (isSuccess ? 'Refund initiated' : 'Refund failed')
      };
    } catch (error) {
      this.logError('Naya Pay refund failed', error);
      return { success: false, message: error instanceof Error ? error.message : 'Refund failed' };
    }
  }

  getConfig(): GatewayConfig {
    return this.config;
  }
}
