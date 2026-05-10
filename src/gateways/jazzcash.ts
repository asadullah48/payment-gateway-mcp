import axios from 'axios';
import { BasePaymentGateway } from './base-gateway.js';
import { PaymentRequest, PaymentResponse, TransactionStatus, RefundResponse, GatewayConfig } from '../types.js';
import { generateHMACSignature, generateTransactionId } from '../signature.js';

export class JazzCashGateway extends BasePaymentGateway {
  name = 'jazzcash';
  
  config: GatewayConfig = {
    name: 'jazzcash',
    isActive: true,
    supportedCurrencies: ['PKR'],
    minAmount: 10,
    maxAmount: 500000,
    environment: (process.env.JAZZCASH_ENV as 'sandbox' | 'production') || 'sandbox'
  };

  private apiEndpoints = {
    sandbox: {
      hostedCheckout: 'https://sandbox.jazzcash.com.pk/ApplicationAPI/API/Payment/HostedCheckout',
      inquiry: 'https://sandbox.jazzcash.com.pk/ApplicationAPI/API/Payment/StatusInquiry',
      refund: 'https://sandbox.jazzcash.com.pk/ApplicationAPI/API/Payment/DoRefundTransaction'
    },
    production: {
      hostedCheckout: 'https://payments.jazzcash.com.pk/ApplicationAPI/API/Payment/HostedCheckout',
      inquiry: 'https://payments.jazzcash.com.pk/ApplicationAPI/API/Payment/StatusInquiry',
      refund: 'https://payments.jazzcash.com.pk/ApplicationAPI/API/Payment/DoRefundTransaction'
    }
  };

  private getCredentials() {
    return {
      merchantId: process.env.JAZZCASH_MERCHANT_ID,
      password: process.env.JAZZCASH_PASSWORD,
      integritySalt: process.env.JAZZCASH_INTEGRITY_SALT
    };
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    try {
      const creds = this.getCredentials();
      if (!creds.merchantId || !creds.password || !creds.integritySalt) {
        throw new Error('JazzCash credentials not configured');
      }

      const transactionId = generateTransactionId('JC');
      const amountInPaisa = Math.round(request.amount * 100);

      const payload: any = {
        pp_Version: '1.1',
        pp_TxnType: 'HOSTED',
        pp_MerchantID: creds.merchantId,
        pp_Password: creds.password,
        pp_TxnRefNo: transactionId,
        pp_Amount: amountInPaisa,
        pp_TxnCurrency: request.currency || 'PKR',
        pp_TxnDateTime: new Date().toISOString().replace(/[-:T.Z]/g, ''),
        pp_BillReference: request.orderId,
        pp_Description: `Payment for order ${request.orderId}`,
        pp_ReturnURL: request.returnUrl || process.env.JAZZCASH_RETURN_URL || 'https://example.com/callback',
        pp_Language: 'EN'
      };

      const signature = generateHMACSignature(payload, creds.integritySalt);
      payload.pp_SecureHash = signature;

      const endpoint = this.apiEndpoints[this.config.environment].hostedCheckout;
      
      return {
        success: true,
        transactionId: transactionId,
        redirectUrl: endpoint,
        paymentData: {
          method: 'POST',
          action: endpoint,
          fields: payload
        }
      };
    } catch (error) {
      this.logError('Failed to create JazzCash payment', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async inquireTransaction(transactionId: string): Promise<TransactionStatus> {
    try {
      const creds = this.getCredentials();
      const payload = {
        pp_MerchantID: creds.merchantId,
        pp_Password: creds.password,
        pp_TxnRefNo: transactionId,
      };

      const signature = generateHMACSignature(payload, creds.integritySalt!);
      const response = await axios.post(this.apiEndpoints[this.config.environment].inquiry, {
        ...payload,
        pp_SecureHash: signature
      });

      return {
        status: response.data.pp_ResponseCode === '000' ? 'success' : 'failed',
        amount: parseFloat(response.data.pp_Amount) / 100,
        currency: 'PKR',
        gatewayTransactionId: response.data.pp_TxnRefNo || transactionId,
        errorMessage: response.data.pp_ResponseMessage
      };
    } catch (error) {
      this.logError('Transaction inquiry failed', error);
      throw error;
    }
  }

  async refundTransaction(transactionId: string, amount?: number): Promise<RefundResponse> {
    try {
      const creds = this.getCredentials();
      const payload: any = {
        pp_MerchantID: creds.merchantId,
        pp_Password: creds.password,
        pp_TxnRefNo: transactionId,
      };
      
      if (amount) {
        payload.pp_Amount = Math.round(amount * 100);
      }

      const signature = generateHMACSignature(payload, creds.integritySalt!);
      const response = await axios.post(this.apiEndpoints[this.config.environment].refund, {
        ...payload,
        pp_SecureHash: signature
      });

      return {
        success: response.data.pp_ResponseCode === '000',
        refundId: response.data.pp_RefundTransactionId,
        amount: amount,
        message: response.data.pp_ResponseMessage
      };
    } catch (error) {
      this.logError('Refund failed', error);
      return { success: false, message: error instanceof Error ? error.message : 'Refund failed' };
    }
  }

  getConfig(): GatewayConfig {
    return this.config;
  }
}