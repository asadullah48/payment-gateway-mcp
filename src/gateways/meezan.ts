import axios from 'axios';
import { BasePaymentGateway } from './base-gateway.js';
import { PaymentRequest, PaymentResponse, TransactionStatus, RefundResponse, GatewayConfig } from '../types.js';
import { generateHMACSignature, generateTransactionId } from '../signature.js';

// Meezan Bank uses the same HPS (Hosted Payment Service) protocol as JazzCash
export class MeezanGateway extends BasePaymentGateway {
  name = 'meezan';

  config: GatewayConfig = {
    name: 'meezan',
    isActive: true,
    supportedCurrencies: ['PKR'],
    minAmount: 10,
    maxAmount: 1000000,
    environment: (process.env.MEEZAN_ENV as 'sandbox' | 'production') || 'sandbox'
  };

  private apiEndpoints = {
    sandbox: {
      hostedCheckout: 'https://sandbox.meezanbank.com/ApplicationAPI/API/2.0/Purchase',
      inquiry: 'https://sandbox.meezanbank.com/ApplicationAPI/API/2.0/StatusInquiry',
      refund: 'https://sandbox.meezanbank.com/ApplicationAPI/API/2.0/Refund'
    },
    production: {
      hostedCheckout: 'https://payments.meezanbank.com/ApplicationAPI/API/2.0/Purchase',
      inquiry: 'https://payments.meezanbank.com/ApplicationAPI/API/2.0/StatusInquiry',
      refund: 'https://payments.meezanbank.com/ApplicationAPI/API/2.0/Refund'
    }
  };

  private getCredentials() {
    return {
      merchantId: process.env.MEEZAN_MERCHANT_ID,
      password: process.env.MEEZAN_PASSWORD,
      integritySalt: process.env.MEEZAN_INTEGRITY_SALT
    };
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    try {
      const creds = this.getCredentials();
      if (!creds.merchantId || !creds.password || !creds.integritySalt) {
        throw new Error('Meezan Bank credentials not configured');
      }

      if (!this.validateAmount(request.amount)) {
        throw new Error(`Amount must be between ${this.config.minAmount} and ${this.config.maxAmount} PKR`);
      }

      const transactionId = generateTransactionId('MZ');
      // Meezan expects amount in paisa (1 PKR = 100 paisa)
      const amountInPaisa = Math.round(request.amount * 100);
      const txnDateTime = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

      const payload: Record<string, any> = {
        pp_Version: '2.0',
        pp_TxnType: 'HOSTED',
        pp_MerchantID: creds.merchantId,
        pp_Password: creds.password,
        pp_TxnRefNo: transactionId,
        pp_Amount: amountInPaisa,
        pp_TxnCurrency: request.currency || 'PKR',
        pp_TxnDateTime: txnDateTime,
        pp_BillReference: request.orderId,
        pp_Description: `Order ${request.orderId}`,
        pp_ReturnURL: request.returnUrl || process.env.MEEZAN_RETURN_URL || 'https://example.com/callback',
        pp_Language: 'EN'
      };

      payload.pp_SecureHash = generateHMACSignature(payload, creds.integritySalt);

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
      this.logError('Failed to create Meezan payment', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async inquireTransaction(transactionId: string): Promise<TransactionStatus> {
    try {
      const creds = this.getCredentials();

      const payload = {
        pp_MerchantID: creds.merchantId!,
        pp_Password: creds.password!,
        pp_TxnRefNo: transactionId
      };

      const response = await axios.post(
        this.apiEndpoints[this.config.environment].inquiry,
        { ...payload, pp_SecureHash: generateHMACSignature(payload, creds.integritySalt!) }
      );

      const data = response.data;
      const succeeded = data?.pp_ResponseCode === '000';

      return {
        status: succeeded ? 'success' : 'failed',
        amount: parseFloat(data?.pp_Amount || '0') / 100,
        currency: 'PKR',
        gatewayTransactionId: data?.pp_TxnRefNo || transactionId,
        errorMessage: succeeded ? undefined : data?.pp_ResponseMessage
      };
    } catch (error) {
      this.logError('Meezan inquiry failed', error);
      throw error;
    }
  }

  async refundTransaction(transactionId: string, amount?: number): Promise<RefundResponse> {
    try {
      const creds = this.getCredentials();

      const payload: Record<string, any> = {
        pp_MerchantID: creds.merchantId!,
        pp_Password: creds.password!,
        pp_TxnRefNo: transactionId
      };

      if (amount !== undefined) {
        payload.pp_Amount = Math.round(amount * 100);
      }

      const response = await axios.post(
        this.apiEndpoints[this.config.environment].refund,
        { ...payload, pp_SecureHash: generateHMACSignature(payload, creds.integritySalt!) }
      );

      const data = response.data;
      const isSuccess = data?.pp_ResponseCode === '000';

      return {
        success: isSuccess,
        refundId: data?.pp_RefundTransactionId,
        amount,
        message: data?.pp_ResponseMessage
      };
    } catch (error) {
      this.logError('Meezan refund failed', error);
      return { success: false, message: error instanceof Error ? error.message : 'Refund failed' };
    }
  }

  getConfig(): GatewayConfig {
    return this.config;
  }
}
