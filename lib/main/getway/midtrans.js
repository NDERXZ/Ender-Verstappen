'use strict';

const crypto = require('crypto');
const axios = require('axios');

const MIDTRANS_CONFIG = {
    sandbox: {
        baseUrl: 'https://api.sandbox.midtrans.com/v2',
        snapUrl: 'https://app.sandbox.midtrans.com/snap/v1',
    },
    production: {
        baseUrl: 'https://api.midtrans.com/v2',
        snapUrl: 'https://app.midtrans.com/snap/v1',
    }
};

class MidtransGateway {
    constructor(serverKey, clientKey, isProduction = false) {
        this.serverKey = serverKey;
        this.clientKey = clientKey;
        this.isProduction = isProduction;
        const env = isProduction ? 'production' : 'sandbox';
        this.baseUrl = MIDTRANS_CONFIG[env].baseUrl;
        this.snapUrl = MIDTRANS_CONFIG[env].snapUrl;
        this.authKey = Buffer.from(this.serverKey + ':').toString('base64');
    }

    _headers() {
        return {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Basic ${this.authKey}`
        };
    }

    async createQrisTransaction(orderId, amount, customerName = '', customerPhone = '') {
        const payload = {
            payment_type: 'qris',
            transaction_details: {
                order_id: orderId,
                gross_amount: amount
            },
            qris: {
                acquirer: 'gopay'
            },
            customer_details: {
                first_name: customerName,
                phone: customerPhone
            },
            custom_expiry: {
                expiry_duration: 10,
                unit: 'minute'
            }
        };

        const { data } = await axios.post(`${this.baseUrl}/charge`, payload, {
            headers: this._headers(),
            timeout: 15000
        });

        return {
            orderId: data.order_id,
            transactionId: data.transaction_id,
            status: data.transaction_status,
            qrString: data.actions?.find(a => a.name === 'generate-qr-code')?.url || '',
            qrUrl: data.actions?.find(a => a.name === 'generate-qr-code')?.url || '',
            amount: data.gross_amount,
            expiry: data.expiry_time || ''
        };
    }

    async createGopayTransaction(orderId, amount, customerName = '', customerPhone = '') {
        const payload = {
            payment_type: 'gopay',
            transaction_details: {
                order_id: orderId,
                gross_amount: amount
            },
            gopay: {
                enable_callback: false,
                callback_url: ''
            },
            customer_details: {
                first_name: customerName,
                phone: customerPhone
            },
            custom_expiry: {
                expiry_duration: 10,
                unit: 'minute'
            }
        };

        const { data } = await axios.post(`${this.baseUrl}/charge`, payload, {
            headers: this._headers(),
            timeout: 15000
        });

        const qrAction = data.actions?.find(a => a.name === 'generate-qr-code');
        const deeplinkAction = data.actions?.find(a => a.name === 'deeplink-redirect');

        return {
            orderId: data.order_id,
            transactionId: data.transaction_id,
            status: data.transaction_status,
            qrUrl: qrAction?.url || '',
            deeplinkUrl: deeplinkAction?.url || '',
            amount: data.gross_amount,
            expiry: data.expiry_time || ''
        };
    }

    async createDanaTransaction(orderId, amount, customerName = '', customerPhone = '') {
        const payload = {
            payment_type: 'shopeepay',
            transaction_details: {
                order_id: orderId,
                gross_amount: amount
            },
            shopeepay: {
                callback_url: ''
            },
            customer_details: {
                first_name: customerName,
                phone: customerPhone
            },
            custom_expiry: {
                expiry_duration: 10,
                unit: 'minute'
            }
        };

        const { data } = await axios.post(`${this.baseUrl}/charge`, payload, {
            headers: this._headers(),
            timeout: 15000
        });

        return {
            orderId: data.order_id,
            transactionId: data.transaction_id,
            status: data.transaction_status,
            deeplinkUrl: data.actions?.find(a => a.name === 'deeplink-redirect')?.url || '',
            qrUrl: data.actions?.find(a => a.name === 'generate-qr-code')?.url || '',
            amount: data.gross_amount,
            expiry: data.expiry_time || ''
        };
    }

    async createSnapTransaction(orderId, amount, customerName = '', customerPhone = '', enabledPayments = ['gopay', 'shopeepay', 'other_qris']) {
        const payload = {
            transaction_details: {
                order_id: orderId,
                gross_amount: amount
            },
            customer_details: {
                first_name: customerName,
                phone: customerPhone
            },
            enabled_payments: enabledPayments,
            expiry: {
                duration: 10,
                unit: 'minutes'
            }
        };

        const { data } = await axios.post(`${this.snapUrl}/transactions`, payload, {
            headers: this._headers(),
            timeout: 15000
        });

        return {
            token: data.token,
            redirectUrl: data.redirect_url,
            orderId: orderId,
            amount: amount
        };
    }

    async checkStatus(orderId) {
        const { data } = await axios.get(`${this.baseUrl}/${orderId}/status`, {
            headers: this._headers(),
            timeout: 10000
        });

        return {
            orderId: data.order_id,
            transactionId: data.transaction_id,
            status: this._mapStatus(data.transaction_status, data.fraud_status),
            rawStatus: data.transaction_status,
            amount: data.gross_amount,
            paymentType: data.payment_type,
            paidAt: data.settlement_time || data.transaction_time || '',
            expiry: data.expiry_time || ''
        };
    }

    async cancelTransaction(orderId) {
        const { data } = await axios.post(`${this.baseUrl}/${orderId}/cancel`, {}, {
            headers: this._headers(),
            timeout: 10000
        });
        return data;
    }

    async expireTransaction(orderId) {
        const { data } = await axios.post(`${this.baseUrl}/${orderId}/expire`, {}, {
            headers: this._headers(),
            timeout: 10000
        });
        return data;
    }

    verifySignature(orderId, statusCode, grossAmount, serverKey) {
        const input = orderId + statusCode + grossAmount + (serverKey || this.serverKey);
        const hash = crypto.createHash('sha512').update(input).digest('hex');
        return hash;
    }

    _mapStatus(transactionStatus, fraudStatus) {
        if (transactionStatus === 'capture') {
            return fraudStatus === 'accept' ? 'paid' : 'challenge';
        }
        const map = {
            'settlement': 'paid',
            'pending': 'pending',
            'deny': 'failed',
            'cancel': 'cancelled',
            'expire': 'expired',
            'failure': 'failed',
            'refund': 'refunded',
            'partial_refund': 'refunded'
        };
        return map[transactionStatus] || 'unknown';
    }

    calculateFee(amount, method = 'qris') {
        const feeRates = {
            qris: { percent: 0.7, flat: 0 },
            gopay: { percent: 2, flat: 0 },
            dana: { percent: 2, flat: 0 },
            va_bca: { percent: 0, flat: 4000 },
            va_mandiri: { percent: 0, flat: 4000 },
            va_bni: { percent: 0, flat: 4000 },
            va_bri: { percent: 0, flat: 4000 },
            alfamart: { percent: 0, flat: 5000 },
            indomaret: { percent: 0, flat: 5000 },
        };
        const rate = feeRates[method] || feeRates.qris;
        const fee = Math.ceil((amount * rate.percent / 100) + rate.flat);
        return fee;
    }
}

module.exports = MidtransGateway;