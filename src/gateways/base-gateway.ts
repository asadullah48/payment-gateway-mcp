import { PaymentRequest, PaymentResponse, TransactionStatus, RefundResponse, GatewayConfig } from '../types.js';

export interface IPaymentGateway {
  readonly name: string;
  createPayment(request: PaymentRequest): Promise<PaymentResponse>;
  inquireTransaction(transactionId: string): Promise<TransactionStatus>;
  refundTransaction(transactionId: string, amount?: number): Promise<RefundResponse>;
  getConfig(): GatewayConfig;
}

export abstract class BasePaymentGateway implements IPaymentGateway {
  abstract readonly name: string;
  abstract config: GatewayConfig;

  abstract createPayment(request: PaymentRequest): Promise<PaymentResponse>;
  abstract inquireTransaction(transactionId: string): Promise<TransactionStatus>;
  abstract refundTransaction(transactionId: string, amount?: number): Promise<RefundResponse>;
  abstract getConfig(): GatewayConfig;

  protected validateAmount(amount: number): boolean {
    return amount >= this.config.minAmount && amount <= this.config.maxAmount;
  }

  protected logError(message: string, error: any): void {
    console.error(`[${this.name}] ${message}:`, error?.message || error);
  }
}