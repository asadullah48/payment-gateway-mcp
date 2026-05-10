export type GatewayName = 'jazzcash' | 'easypaisa' | 'nayapay' | 'meezan' | 'alfalah' | 'checkout';

export interface PaymentRequest {
  gateway: GatewayName;
  amount: number;
  currency?: string;
  orderId: string;
  customerInfo: {
    name?: string;
    email?: string;
    phone?: string;
  };
  returnUrl?: string;
}

export interface PaymentResponse {
  success: boolean;
  transactionId?: string;
  redirectUrl?: string;
  paymentData?: any;
  error?: string;
}

export interface TransactionStatus {
  status: 'pending' | 'success' | 'failed' | 'refunded';
  amount: number;
  currency: string;
  gatewayTransactionId: string;
  errorMessage?: string;
}

export interface RefundResponse {
  success: boolean;
  refundId?: string;
  amount?: number;
  message?: string;
}

export interface GatewayConfig {
  name: GatewayName;
  isActive: boolean;
  supportedCurrencies: string[];
  minAmount: number;
  maxAmount: number;
  environment: 'sandbox' | 'production';
}