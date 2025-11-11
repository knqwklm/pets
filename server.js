// server.js — minimal Node/Express server for demo (serves static files + PayPal create/capture)
// Install: npm install express node-fetch@2 cors dotenv
const path = require('path');
const express = require('express');
const fetch = require('node-fetch'); // v2
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend (assumes index.html in ./public)
app.use(express.static(path.join(__dirname, 'public')));

// Config
const PAYPAL_CLIENT = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';
const PAYPAL_ENV = process.env.PAYPAL_ENV === 'production' ? 'production' : 'sandbox';
const PAYPAL_BASE = PAYPAL_ENV === 'production' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

// Simple product catalog
const PRICES = {
  'cloudrest-cozy-dog-bed': { S: '39.99', M: '49.99', L: '59.99' }
};

async function getAccessToken() {
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${PAYPAL_CLIENT}:${PAYPAL_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error('PayPal token error: ' + err);
  }
  const data = await res.json();
  return data.access_token;
}

// Create order
app.post('/api/paypal/create-order', async (req, res) => {
  try {
    const { productId, qty = 1, size = 'M' } = req.body;
    if (!productId || !PRICES[productId]) return res.status(400).json({ error: 'Invalid product' });

    const unitPrice = PRICES[productId][size] || PRICES[productId]['M'];
    const total = (parseFloat(unitPrice) * Number(qty)).toFixed(2);

    const accessToken = await getAccessToken();
    const createRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: {
            currency_code: 'EUR',
            value: total
          },
          description: `CloudRest Cozy Dog Bed (${size})`
        }],
        application_context: {
          brand_name: 'FluffyFriend',
          landing_page: 'NO_PREFERENCE',
          user_action: 'PAY_NOW'
        }
      })
    });

    const createData = await createRes.json();
    if (!createRes.ok) {
      console.error('PayPal create order error:', createData);
      return res.status(500).json({ error: 'PayPal create failed', details: createData });
    }

    res.json({ orderID: createData.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Capture order
app.post('/api/paypal/capture-order', async (req, res) => {
  try {
    const { orderID } = req.body;
    if (!orderID) return res.status(400).json({ error: 'orderID required' });

    const accessToken = await getAccessToken();
    const capRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderID}/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      }
    });

    const capData = await capRes.json();
    if (!capRes.ok) {
      console.error('PayPal capture error:', capData);
      return res.status(500).json({ error: 'Capture failed', details: capData });
    }

    // TODO: save to DB, trigger fulfillment, send email
    res.json(capData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Webhook stub
app.post('/api/paypal/webhook', express.json({ type: '*/*' }), (req, res) => {
  console.log('Webhook event:', req.body && req.body.event_type);
  res.status(200).send('ok');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT} (env=${PAYPAL_ENV})`));
