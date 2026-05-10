import axios from 'axios';
import { BasePaymentGateway } from './base-gateway.js';
import { PaymentRequest, PaymentResponse, TransactionStatus, RefundResponse, GatewayConfig } from '../types.js';
import { generateHMACSignature, generateTransactionId } from '../signature.js';

// Bank Alfalah BAFT (Bank Alfalah Financial Technology) Gateway
export class AlfalahGateway extends BasePaymentGateway {
  name = 'alfalah';

  config: GatewayConfig = {
    name: 'alfalah',
    isActive: true,
    supportedCurrencies: ['PKR', 'USD'],
    minAmount: 10,
    maxAmount: 2000000,
    environment: (process.env.ALFALAH_ENV as 'sandbox' | 'production') || 'sandbox'
  };

  private apiEndpoints = {
    sandbox: {
      hostedCheckout: 'https://sandbox.bankalfalah.com/HS/HS/Hash',
      inquiry: 'https://sandbox.bankalfalah.com/HS/HS/TransactionStatusInquiry',
      refund: 'https://sandbox.bankalfalah.com/HS/HS/Refund'
    },
    production: {
      hostedCheckout: 'https://payments.bankalfalah.com/HS/HS/Hash',
      inquiry: 'https://payments.bankalfalah.com/HS/HS/TransactionStatusInquiry',
      refund: 'https://payments.bankalfalah.com/HS/HS/Refund'
    }
  };

  private getCredentials() {
    return {
      merchantId: process.env.ALFALAH_MERCHANT_ID,
      merchantKey: process.env.ALFALAH_MERCHANT_KEY,
      channelId: process.env.ALFALAH_CHANNEL_ID || '1001'
    };
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    try {
      const creds = this.getCredentials();
      if (!creds.merchantId || !creds.merchantKey) {
        throw new Error('Bank Alfalah credentials not configured');
      }

      if (!this.validateAmount(request.amount)) {
        throw new Error(`Amount must be between ${this.config.minAmount} and ${this.config.maxAmount}`);
      }

      const transactionId = generateTransactionId('AF');
      const currency = request.currency || 'PKR';
      const returnUrl = request.returnUrl || process.env.ALFALAH_RETURN_URL || 'https://example.com/callback';

      // Hash covers the key transaction fields
      const hashFields = {
        merchantId: creds.merchantId,
        channelId: creds.channelId,
        returnUrl,
        orderId: request.orderId,
        amount: request.amount.toFixed(2),
        currency
      };

      const payload: Record<string, any> = {
        HS_MerchantId: creds.merchantId,
        HS_ChannelId: creds.channelId,
        HS_ReturnURL: returnUrl,
        HS_MerchantUsername: creds.merchantId,
        HS_MerchantPassword: creds.merchantKey,
        HS_RequestHash: generateHMACSignature(hashFields, creds.merchantKey),
        HS_TransactionReferenceNo: transactionId,
        HS_StoreId: creds.merchantId,
        HS_OrderId: request.orderId,
        HS_TransactionAmount: request.amount.toFixed(2),
        HS_Currency: currency,
        HS_IsRedirectionRequest: '0'
      };

      const endpoint = this.apiEndpoints[this.config.environment].hostedCheckout;

      return {
        success: true,
        transactionId,
        redirectUrl: endpoint,
        paymentData: {
          method: 'POST',
          action: endpoint,
          fields: payload
        }
      };
    } catch (error) {
      this.logError('Failed to create Alfalah payment', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async inquireTransaction(transactionId: string): Promise<TransactionStatus> {
    try {
      const creds = this.getCredentials();

      const payload = {
        HS_MerchantId: creds.merchantId!,
        HS_ChannelId: creds.channelId,
        HS_TransactionReferenceNo: transactionId
      };

      const response = await axios.post(
        this.apiEndpoints[this.config.environment].inquiry,
        { ...payload, HS_RequestHash: generateHMACSignature(payload, creds.merchantKey!) }
      );

      const data = response.data;
      const succeeded = data?.HS_ResponseCode === '00' || data?.HS_TransactionStatus === 'Paid';

      return {
        status: succeeded ? 'success' : data?.HS_TransactionStatus === 'Pending' ? 'pending' : 'failed',
        amount: parseFloat(data?.HS_TransactionAmount || '0'),
        currency: data?.HS_Currency || 'PKR',
        gatewayTransactionId: data?.HS_AuthorizationCode || transactionId,
        errorMessage: succeeded ? undefined : data?.HS_ResponseMessage
      };
    } catch (error) {
      this.logError('Alfalah inquiry failed', error);
      throw error;
    }
  }

  async refundTransaction(transactionId: string, amount?: number): Promise<RefundResponse> {
    try {
      const creds = this.getCredentials();

      const payload: Record<string, any> = {
        HS_MerchantId: creds.merchantId!,
        HS_ChannelId: creds.channelId,
        HS_TransactionReferenceNo: transactionId
      };

      if (amount !== undefined) {
        payload.HS_TransactionAmount = amount.toFixed(2);
      }

      const response = await axios.post(
        this.apiEndpoints[this.config.environment].refund,
        { ...payload, HS_RequestHash: generateHMACSignature(payload, creds.merchantKey!) }
      );

      const data = response.data;
      const isSuccess = data?.HS_ResponseCode === '00';

      return {
        success: isSuccess,
        refundId: data?.HS_RefundTransactionId,
        amount,
        message: data?.HS_ResponseMessage
      };
    } catch (error) {
      this.logError('Alfalah refund failed', error);
      return { success: false, message: error instanceof Error ? error.message : 'Refund failed' };
    }
  }

  getConfig(): GatewayConfig {
    return this.config;
  }
}
