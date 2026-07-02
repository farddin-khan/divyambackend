const BASE_URL = process.env.SHIPROCKET_BASE_URL || 'https://apiv2.shiprocket.in/v1/external';
const EMAIL = process.env.SHIPROCKET_EMAIL;
const PASSWORD = process.env.SHIPROCKET_PASSWORD;
const STORE_ID = process.env.SHIPROCKET_STORE_ID;

async function getShiprocketToken() {
  if (!EMAIL || !PASSWORD) {
    throw new Error('Shiprocket credentials are missing.');
  }

  const response = await fetch(`${BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Shiprocket login failed: ${message}`);
  }

  const data = await response.json();
  return data.token;
}

export async function sendShiprocketOrder(orderData, customer, cartItems, shipping, totalAmount) {
  if (!STORE_ID) {
    throw new Error('Shiprocket store ID missing.');
  }

  const token = await getShiprocketToken();
  const weight = Number(
    cartItems.reduce(
      (sum, item) => sum + ((item.product_weight && parseFloat(item.product_weight)) || 0) * item.quantity,
      0,
    ),
  ) || 0.5;

  const payload = {
    order_id: orderData.id.toString(),
    order_date: new Date().toISOString().split('T')[0],
    channel_id: '1',
    billing_customer_name: `${customer.firstName} ${customer.lastName}`,
    billing_address: customer.address,
    billing_city: customer.city,
    billing_pincode: customer.zip,
    billing_state: customer.state,
    billing_country: 'India',
    billing_email: customer.email,
    billing_phone: customer.phone,
    shipping_is_billing: true,
    order_items: cartItems.map((item) => ({
      name: item.product_name,
      sku: item.product_sku || item.product_id?.toString() || `SKU-${item.product_id}`,
      units: item.quantity,
      selling_price: Number(item.product_price || 0),
    })),
    payment_method: 'Prepaid',
    sub_total: Number(totalAmount - shipping),
    shipping_charges: Number(shipping),
    total_amount: Number(totalAmount),
    length: 10,
    breadth: 10,
    height: 10,
    weight,
    store_id: STORE_ID,
  };

  const response = await fetch(`${BASE_URL}/orders/create/adhoc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Shiprocket order creation failed: ${message}`);
  }

  const data = await response.json();
  return {
    shiprocketOrderId: data.order_id || data.data?.order_id,
    status: data.status || 'created',
  };
}
