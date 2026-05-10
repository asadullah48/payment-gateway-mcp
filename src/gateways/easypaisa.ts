import axios from 'axios';
import { BasePaymentGateway } from './base-gateway.js';
import { PaymentRequest, PaymentResponse, TransactionStatus, RefundResponse, GatewayConfig } from '../types.js';
import { generateHMACSHA1Signature, generateTransactionId } from '../signature.js';

export class EasypaisaGateway extends BasePaymentGateway {
  name = 'easypaisa';

  config: GatewayConfig = {
    name: 'easypaisa',
    isActive: true,
    supportedCurrencies: ['PKR'],
    minAmount: 1,
    maxAmount: 200000,
    environment: (process.env.EASYPAISA_ENV as 'sandbox' | 'production') || 'sandbox'
  };

  private apiEndpoints = {
    sandbox: {
      payment: 'https://easypaystg.easypaisa.com.pk/tpg/',
      inquiry: 'https://easypaystg.easypaisa.com.pk/tpg/'
    },
    production: {
      payment: 'https://easypay.easypaisa.com.pk/tpg/',
      inquiry: 'https://easypay.easypaisa.com.pk/tpg/'
    }
  };

  private getCredentials() {
    return {
      storeId: process.env.EASYPAISA_STORE_ID,
      hashKey: process.env.EASYPAISA_HASH_KEY
    };
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    try {
      const creds = this.getCredentials();
      if (!creds.storeId || !creds.hashKey) {
        throw new Error('EasyPaisa credentials not configured');
      }

      if (!this.validateAmount(request.amount)) {
        throw new Error(`Amount must be between ${this.config.minAmount} and ${this.config.maxAmount} PKR`);
      }

      const transactionId = generateTransactionId('EP');
      const amountStr = request.amount.toFixed(2);
      const endpoint = this.apiEndpoints[this.config.environment].payment;
      const returnUrl = request.returnUrl || process.env.EASYPAISA_RETURN_URL || 'https://example.com/callback';

      // Use MA_PAYMENT (Mobile Account) if phone provided, else OTC (walk-in retailer)
      const paymentMethod = request.customerInfo?.phone ? 'MA_PAYMENT' : 'OTC_PAYMENT';

      const hashData = {
        storeId: creds.storeId,
        amount: amountStr,
        orderRefNum: request.orderId
      };
      const authToken = generateHMACSHA1Signature(hashData, creds.hashKey);

      const payload: Record<string, string> = {
        storeId: creds.storeId,
        amount: amountStr,
        postBackURL: returnUrl,
        orderRefNum: request.orderId,
        expiryDate: this.getExpiryDate(),
        paymentMethod,
        token: authToken
      };

      if (request.customerInfo?.phone) {
        payload.mobileNum = request.customerInfo.phone;
      }

      const response = await axios.post(endpoint, new URLSearchParams(payload), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      const isSuccess = response.data?.responseCode === '0000';

      return {
        success: isSuccess,
        transactionId: isSuccess ? transactionId : undefined,
        redirectUrl: isSuccess ? (response.data?.paymentUrl || endpoint) : undefined,
        paymentData: {
          method: paymentMethod,
          transactionId,
          response: response.data
        },
        error: isSuccess ? undefined : (response.data?.responseDesc || 'EasyPaisa payment failed')
      };
    } catch (error) {
      this.logError('Failed to create EasyPaisa payment', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async inquireTransaction(transactionId: string): Promise<TransactionStatus> {
    try {
      const creds = this.getCredentials();
      const endpoint = this.apiEndpoints[this.config.environment].inquiry;

      const hashData = { storeId: creds.storeId!, transactionRefNum: transactionId };
      const authToken = generateHMACSHA1Signature(hashData, creds.hashKey!);

      const payload = new URLSearchParams({
        storeId: creds.storeId!,
        transactionRefNum: transactionId,
        token: authToken
      });

      const response = await axios.post(endpoint, payload, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      const data = response.data;
      const succeeded = data?.responseCode === '0000';

      return {
        status: succeeded ? 'success' : data?.responseCode === 'PENDING' ? 'pending' : 'failed',
        amount: parseFloat(data?.transactionAmount || '0'),
        currency: 'PKR',
        gatewayTransactionId: data?.transactionId || transactionId,
        errorMessage: succeeded ? undefined : data?.responseDesc
      };
    } catch (error) {
      this.logError('EasyPaisa inquiry failed', error);
      throw error;
    }
  }

  // EasyPaisa does not expose a programmatic refund API — merchant portal only
  async refundTransaction(_transactionId: string, _amount?: number): Promise<RefundResponse> {
    return {
      success: false,
      message: 'EasyPaisa refunds must be processed via the merchant portal at https://easypay.easypaisa.com.pk'
    };
  }

  getConfig(): GatewayConfig {
    return this.config;
  }

  private getExpiryDate(): string {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 1);
    return expiry.toISOString().split('T')[0].replace(/-/g, '') + '235959';
  }
}
