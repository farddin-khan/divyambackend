import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import Razorpay from 'razorpay';
import { createClient } from '@supabase/supabase-js';
import { sendShiprocketOrder } from './shiprocket.js';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { buildProductPayload, normalizeImages, normalizeBenefits } from './utils/adminProductUtils.js';
import loyaltyRoutes from "./routes/loyaltyRoutes.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// Load environment variables from .env files
const envPath = path.resolve(__dirname, '../.env');
const envPathServer = path.resolve(__dirname, '.env');

dotenv.config({ path: envPath });
dotenv.config({ path: envPathServer, override: true });
dotenv.config();

// Debug: log what was loaded
console.log('[Server Init] Loading env from:', envPath);
if (fs.existsSync(envPath)) {
  console.log('[Server Init] ✓ .env file found at project root');
} else {
  console.log('[Server Init] ⚠ .env file NOT found at project root');
}
if (fs.existsSync(envPathServer)) {
  console.log('[Server Init] ✓ .env file found in server directory');
}

const app = express();
const port = process.env.PORT || 4000;
const REVIEW_APPROVAL_EMAIL = 'farddinkhan18@gmail.com';

app.use("/api/loyalty", loyaltyRoutes);

app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/images', express.static(path.join(__dirname, '..', 'public', 'images')));

app.post("/api/test", (req, res) => {
  res.json({
    success: true,
    body: req.body
  });
});

// Friendly JSON response when the payload is too large
app.use((err, req, res, next) => {
  if (!err) return next();
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({ error: 'Payload Too Large' });
  }
  return next(err);
});

const shiprocketRouter = express.Router();

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.warn('Razorpay credentials are missing in server environment.');
}

if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('Supabase service role configuration is missing in server environment.');
}

if (!process.env.ADMIN_SECRET) {
  console.warn('Admin secret is not configured. Admin product creation requires ADMIN_SECRET.');
}

if (!process.env.ADMIN_USER_ID) {
  console.warn('Admin user id is not configured. Admin panel can still use ADMIN_SECRET only.');
}

let razorpay = null;
let supabase = null;

console.log('[Server Init] Supabase URL:', process.env.VITE_SUPABASE_URL ? '✓ Configured' : '✗ Missing');
console.log('[Server Init] SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✓ Configured' : '✗ Missing');
console.log('[Server Init] VITE_SUPABASE_ANON_KEY:', process.env.VITE_SUPABASE_ANON_KEY ? '✓ Configured' : '✗ Missing');
console.log('[Server Init] ADMIN_SECRET:', process.env.ADMIN_SECRET ? '✓ Configured' : '✗ Missing');

const missingRazorpayEnv = [];
if (!process.env.RAZORPAY_KEY_ID) missingRazorpayEnv.push('RAZORPAY_KEY_ID');
if (!process.env.RAZORPAY_KEY_SECRET) missingRazorpayEnv.push('RAZORPAY_KEY_SECRET');

if (missingRazorpayEnv.length > 0) {
  console.warn('⚠ Razorpay payment endpoints are disabled. Missing:', missingRazorpayEnv.join(', '));
} else {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
  console.log('✓ Razorpay initialized');
}

const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const missingSupabaseEnv = [];
if (!process.env.VITE_SUPABASE_URL) missingSupabaseEnv.push('VITE_SUPABASE_URL');
if (!supabaseKey) missingSupabaseEnv.push('SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY');

if (missingSupabaseEnv.length > 0) {
  console.error('✗ CRITICAL: Supabase-backed endpoints are disabled. Missing:', missingSupabaseEnv.join(', '));
  console.error('  Admin product management requires: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
} else {
  try {
    supabase = createClient(process.env.VITE_SUPABASE_URL, supabaseKey);
    console.log('✓ Supabase initialized with', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'service role' : 'anon key');
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.warn('⚠ SUPABASE_SERVICE_ROLE_KEY missing. Admin write operations may be limited in production.');
    }
  } catch (error) {
    console.error('✗ Failed to initialize Supabase:', error.message);
    supabase = null;
  }
}

let mailTransporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS) {
  mailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  mailTransporter.verify((error) => {
    if (error) {
      console.warn('SMTP warning:', error.message || error);
    } else {
      console.log('SMTP Server is ready.');
    }
  });
} else {
  console.warn('SMTP configuration is missing; review approval emails will not be sent.');
}

// Configure multer for multipart/form-data uploads to public/images/products
const uploadDir = path.join(__dirname, '..', 'public', 'images', 'products');
try {
  fs.mkdirSync(uploadDir, { recursive: true });
} catch (err) {}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, filename);
  },
});

const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getAdminCredentials() {
  return {
    userId: String(process.env.ADMIN_USER_ID || 'admin').trim(),
    secret: String(process.env.ADMIN_SECRET || 'admin').trim(),
  };
}

function adminAccessGranted(secret, userId) {
  const adminCredentials = getAdminCredentials();
  const submittedSecret = String(secret || '').trim();
  const submittedUserId = String(userId || '').trim();

  if (submittedSecret !== adminCredentials.secret) {
    return false;
  }

  if (submittedUserId !== adminCredentials.userId) {
    return false;
  }

  return true;
}

function getWeightParts(weightValue) {
  const rawWeight = String(weightValue || '').trim();
  const amount = Number.parseFloat(rawWeight);
  const unitMatch = rawWeight.match(/[a-zA-Z]+/);
  const unit = unitMatch ? unitMatch[0].toLowerCase() : 'kg';

  return {
    weight: Number.isFinite(amount) ? amount : 0,
    unit,
  };
}

function mapProductImages(product) {
  const imageSources = Array.isArray(product.images)
    ? product.images
    : typeof product.images === 'string'
    ? product.images.split(',').map((item) => item.trim()).filter(Boolean)
    : [];

  return imageSources.map((src, index) => ({
    id: `${product.id || 'product'}-${index + 1}`,
    product_id: product.id,
    position: index + 1,
    created_at: product.created_at,
    updated_at: product.updated_at,
    src,
  }));
}

function mapProductForShiprocket(product) {
  const images = mapProductImages(product);
  const primaryImage = images[0] || { src: null };
  const stockQuantity = Number(product.stock_quantity ?? product.inventory_quantity ?? product.stock ?? 0);
  const { weight, unit } = getWeightParts(product.weight);
  const grams = unit === 'g' || unit === 'gram' || unit === 'grams' ? weight : weight * 1000;
  const variantId = product.variant_id || product.id;

  return {
    ...product,
    id: product.id,
    title: product.name || product.title || '',
    body_html: product.description || product.body_html || '',
    vendor: product.vendor || 'Divyam Ayurveda',
    product_type: product.product_type || product.category?.name || '',
    created_at: product.created_at,
    updated_at: product.updated_at,
    status: product.status || 'active',
    handle: product.slug || product.handle || '',
    collection_handle: product.category?.slug || null,
    collection_title: product.category?.name || null,
    variants: [
      {
        id: variantId,
        product_id: product.id,
        title: product.variant_title || 'Default',
        price: String(product.price ?? ''),
        compare_at_price: product.compare_price == null ? '' : String(product.compare_price),
        sku: product.sku || product.slug || `product-${product.id}`,
        quantity: stockQuantity,
        inventory_quantity: stockQuantity,
        taxable: true,
        requires_shipping: true,
        grams: Number.isFinite(grams) ? grams : 0,
        weight,
        weight_unit: unit,
        inventory_management: 'shopify',
        inventory_policy: 'continue',
        created_at: product.created_at,
        updated_at: product.updated_at,
        image: primaryImage,
      },
    ],
    images,
    image: primaryImage,
    options: [
      {
        id: `${product.id || 'product'}-option-1`,
        product_id: product.id,
        name: 'Title',
        position: 1,
        values: ['Default'],
      },
    ],
    raw: product,
  };
}

async function saveDataUrlImage(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
  const match = dataUrl.match(/^data:(image\/[-+a-zA-Z0-9.]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  const ext = mime.split('/')[1] || 'png';
  const base64 = match[2];
  const buffer = Buffer.from(base64, 'base64');
  const dir = path.join(__dirname, '..', 'public', 'images', 'products');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
    const filePath = path.join(dir, filename);
    await fs.promises.writeFile(filePath, buffer);
    return `/images/products/${filename}`;
  } catch (err) {
    console.warn('saveDataUrlImage error:', err.message || err);
    return null;
  }
}

function sendShiprocketFallback(res, key) {
  return res.json({
    data: {
      total: 0,
      [key]: [],
    },
  });
}

async function attachOrderItems(orders) {
  if (!orders?.length) {
    return [];
  }

  const orderIds = orders.map((order) => order.id).filter(Boolean);
  if (!orderIds.length) {
    return orders.map((order) => ({ ...order, items: [] }));
  }

  const { data: items, error } = await supabase
    .from('order_items')
    .select('*')
    .in('order_id', orderIds);

  if (error) {
    console.warn('Unable to load order items:', error.message);
    return orders.map((order) => ({ ...order, items: [] }));
  }

  const groupedItems = (items || []).reduce((acc, item) => {
    const key = String(item.order_id);
    acc[key] = acc[key] || [];
    acc[key].push(item);
    return acc;
  }, {});

  return orders.map((order) => ({
    ...order,
    items: groupedItems[String(order.id)] || [],
  }));
}
app.post('/api/payment/create-order', async (req, res) => {
  try {
    if (!razorpay || !supabase) {
      return res.status(500).json({ error: 'Server configuration is invalid. Check API env variables.' });
    }

    const { formData, cartItems, shipping, total, selectedPaymentMethod, sessionId } = req.body;

    if (!formData || !cartItems || cartItems.length === 0) {
      return res.status(400).json({ error: 'Missing order details.' });
    }

    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .insert({
        session_id: sessionId,
        total_amount: total,
        customer_email: formData.email,
        customer_name: `${formData.firstName} ${formData.lastName}`,
        customer_phone: formData.phone,
        shipping_address: {
          address: formData.address,
          city: formData.city,
          state: formData.state,
          zip: formData.zip,
        },
        notes: formData.notes,
        payment_method: selectedPaymentMethod,
        payment_status: 'pending',
      })
      .select()
      .single();

    if (orderError) {
      throw orderError;
    }

    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(total * 100),
      currency: 'INR',
      receipt: `order_${orderData.id}`,
      payment_capture: 1,
    });

    await supabase
      .from('orders')
      .update({ razorpay_order_id: razorpayOrder.id })
      .eq('id', orderData.id);

    return res.json({
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      orderDbId: orderData.id,
    });
  } catch (error) {
    console.error('create-order error:', error);
    return res.status(500).json({ error: error.message || 'Unable to create Razorpay order.' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK' });
});

app.post('/api/reviews/request-approval', async (req, res) => {
  try {
    const {
      name = 'Anonymous',
      rating,
      text,
      product = 'Divyam product',
      location = 'India',
      timestamp,
    } = req.body;

    if (!rating || !text) {
      return res.status(400).json({
        success: false,
        error: 'Rating and review text are required.',
      });
    }

    if (!mailTransporter) {
      console.warn('Review approval email skipped because SMTP is not configured.');
      return res.json({
        success: true,
        emailSent: false,
        message: 'Review received. Approval email is not configured on this server right now.',
      });
    }

    const submittedAt = timestamp
      ? new Date(timestamp).toLocaleString('en-IN')
      : new Date().toLocaleString('en-IN');

    const subject = `New review approval request from ${name}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #111827;">
        <h2 style="margin: 0 0 8px; font-size: 24px;">New Review Submitted</h2>
        <p style="margin: 0 0 22px; color: #6b7280; line-height: 1.6;">
          A customer has submitted a new review. Please check and approve it from admin mode.
        </p>

        <div style="padding: 20px; border: 1px solid #e5e7eb; border-radius: 14px; background: #f9fafb;">
          <p><strong>Name:</strong> ${escapeHtml(name)}</p>
          <p><strong>Location:</strong> ${escapeHtml(location)}</p>
          <p><strong>Product:</strong> ${escapeHtml(product)}</p>
          <p><strong>Rating:</strong> ${escapeHtml(rating)} / 5</p>
          <p><strong>Submitted At:</strong> ${escapeHtml(submittedAt)}</p>
          <p><strong>Review:</strong></p>
          <p style="line-height: 1.7;">${escapeHtml(text)}</p>
        </div>

        <p style="margin-top: 22px; color: #374151;">
          Open your website with <strong>?admin=1</strong> to approve this review.
        </p>
      </div>
    `;

    await mailTransporter.sendMail({
      from: `"Divyam Reviews" <${process.env.SMTP_USER}>`,
      to: REVIEW_APPROVAL_EMAIL,
      subject,
      html,
    });

    return res.json({
      success: true,
      emailSent: true,
      message: `Approval email sent to ${REVIEW_APPROVAL_EMAIL}.`,
    });
  } catch (error) {
    console.error('Review Email Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Unable to send approval email.',
    });
  }
});
shiprocketRouter.get('/collections', async (req, res) => {
  try {
    if (!supabase) {
      return sendShiprocketFallback(res, 'collections');
    }

    const { data: categories, error } = await supabase.from('categories').select('*').order('sort_order', { ascending: true });
    if (error) {
      throw error;
    }

    const collections = (categories || []).map((collection) => ({
      id: collection.id,
      updated_at: collection.updated_at,
      body_html: collection.description || '',
      handle: collection.slug,
      image: { src: collection.image_url || null },
      title: collection.name,
      created_at: collection.created_at,
    }));

    return res.json({ data: { total: collections.length, collections } });
  } catch (error) {
    console.warn('shiprocket-collections fallback:', error.message || error);
    return sendShiprocketFallback(res, 'collections');
  }
});

shiprocketRouter.get('/products', async (req, res) => {
  try {
    if (!supabase) {
      return sendShiprocketFallback(res, 'products');
    }

    const { data: products, error } = await supabase
      .from('products')
      .select('*, category:categories(*)')
      .order('created_at', { ascending: false });
    if (error) {
      throw error;
    }

    const mappedProducts = (products || []).map(mapProductForShiprocket);

    return res.json({ data: { total: mappedProducts.length, products: mappedProducts } });
  } catch (error) {
    console.warn('shiprocket-products fallback:', error.message || error);
    return sendShiprocketFallback(res, 'products');
  }
});

shiprocketRouter.get('/collection-products', async (req, res) => {
  try {
    if (!supabase) {
      return sendShiprocketFallback(res, 'products');
    }

    const { collection_id } = req.query;
    if (!collection_id) {
      return sendShiprocketFallback(res, 'products');
    }

    const { data: category, error: categoryError } = await supabase
      .from('categories')
      .select('*')
      .or(`slug.eq.${collection_id},name.eq.${collection_id},id.eq.${collection_id}`)
      .single();

    if (categoryError || !category) {
      return sendShiprocketFallback(res, 'products');
    }

    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('*, category:categories(*)')
      .eq('category_id', category.id)
      .order('created_at', { ascending: false });

    if (productsError) {
      throw productsError;
    }

    const mappedProducts = (products || []).map(mapProductForShiprocket);

    return res.json({ data: { total: mappedProducts.length, products: mappedProducts } });
  } catch (error) {
    console.warn('shiprocket-collection-products fallback:', error.message || error);
    return sendShiprocketFallback(res, 'products');
  }
});

app.use('/api/products/shiprocket', shiprocketRouter);

app.get('/api/collections', async (req, res) => {
  try {
    if (!supabase) {
      return res.json({ collections: [
        { id: 1, slug: 'hair-care', name: 'Hair Care', description: 'Gentle herbal care for stronger, healthier hair.', image_url: 'https://images.pexels.com/photos/3762875/pexels-photo-3762875.jpeg?auto=compress&cs=tinysrgb&w=800' },
        { id: 2, slug: 'skin-care', name: 'Skin Care', description: 'Pure botanical formulations for nourished, radiant skin.', image_url: 'https://images.pexels.com/photos/3822906/pexels-photo-3822906.jpeg?auto=compress&cs=tinysrgb&w=800' },
        { id: 3, slug: 'wellness', name: 'Wellness', description: 'Daily support for vitality, balance, and holistic wellness.', image_url: 'https://images.pexels.com/photos/3738349/pexels-photo-3738349.jpeg?auto=compress&cs=tinysrgb&w=800' }
      ] });
    }

    const { data, error } = await supabase.from('categories').select('*').order('sort_order', { ascending: true });
    if (error) {
      throw error;
    }

    return res.json({ collections: data || [] });
  } catch (error) {
    console.error('get-collections error:', error);
    return res.status(500).json({ error: error.message || 'Unable to fetch collections.' });
  }
});

app.get('/api/collections/:slug/products', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Server configuration is invalid. Check API env variables.' });
    }

    const { slug } = req.params;
    const { data: category, error: categoryError } = await supabase
      .from('categories')
      .select('id')
      .eq('slug', slug)
      .single();

    if (categoryError || !category) {
      return res.status(404).json({ error: 'Collection not found.' });
    }

    const { data, error } = await supabase
      .from('products')
      .select('*, category:categories(*)')
      .eq('category_id', category.id)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return res.json({ products: data || [] });
  } catch (error) {
    console.error('get-products-by-collection error:', error);
    return res.status(500).json({ error: error.message || 'Unable to fetch products for collection.' });
  }
});

app.get('/api/products', async (req, res) => {
  try {
    if (!supabase) {
      return res.json({ products: [
        { id: 101, slug: 'vitamin-c-face-serum', name: 'Vitamin C Face Serum', short_description: 'Brightens skin and helps improve your glow naturally.', description: 'A lightweight, radiance-boosting serum infused with vitamin C and Ayurvedic botanicals for a fresh, healthy complexion.', price: 4599, compare_price: 5500, sku: 'DIVYAM-VC-001', stock_quantity: 24, category_id: 2, category: { id: 2, name: 'Skin Care', slug: 'skin-care' }, images: ['https://images.pexels.com/photos/3762875/pexels-photo-3762875.jpeg?auto=compress&cs=tinysrgb&w=800'], new_arrival: true, featured: true, reviews: [{ customer_name: 'Priya', rating: 5, review_text: 'Beautiful texture and visible glow.' }], benefits: ['Brightens skin tone', 'Supports collagen health', 'Lightweight everyday use'], ingredients: 'Vitamin C, Indian Gooseberry, Aloe Vera', how_to_use: 'Apply 2-3 drops to clean skin in the morning and follow with moisturizer.', weight: '30 ml' },
        { id: 102, slug: 'ashwagandha-capsules', name: 'Ashwagandha Capsules', short_description: 'A classic adaptogenic supplement for calm and resilience.', description: 'Ashwagandha capsules crafted to support stress balance, recovery, and everyday energy.', price: 3499, compare_price: 4200, sku: 'DIVYAM-AW-002', stock_quantity: 18, category_id: 3, category: { id: 3, name: 'Wellness', slug: 'wellness' }, images: ['https://images.pexels.com/photos/3822906/pexels-photo-3822906.jpeg?auto=compress&cs=tinysrgb&w=800'], new_arrival: false, featured: true, reviews: [{ customer_name: 'Rohan', rating: 5, review_text: 'Helps me stay balanced during busy days.' }], benefits: ['Supports stress resilience', 'Encourages calm focus', 'Daily wellness support'], ingredients: 'Ashwagandha root extract, natural capsule shell', how_to_use: 'Take one capsule twice daily with meals or as directed by your physician.', weight: '60 capsules' },
        { id: 103, slug: 'testostro-booster', name: 'TestoStron Booster', short_description: 'Herbal vitality support for strength and stamina.', description: 'A time-tested blend crafted to support strength, endurance, and overall masculine vitality.', price: 34099, compare_price: 42000, sku: 'DIVYAM-TS-003', stock_quantity: 9, category_id: 3, category: { id: 3, name: 'Wellness', slug: 'wellness' }, images: ['https://images.pexels.com/photos/4041391/pexels-photo-4041391.jpeg?auto=compress&cs=tinysrgb&w=800'], new_arrival: false, featured: true, reviews: [], benefits: ['Supports stamina', 'Builds everyday vitality', 'Herbal formulation'], ingredients: 'Shilajit, Safed Musli, Gokshura', how_to_use: 'Take one serving daily with warm water after meals.', weight: '100 g' },
        { id: 104, slug: 'natural-strength', name: 'Natural Strength', short_description: 'A nourishing herbal blend for overall strength and endurance.', description: 'An Ayurvedic herbal blend intended for daily wellness and strength support.', price: 34099, compare_price: 42000, sku: 'DIVYAM-NS-004', stock_quantity: 12, category_id: 3, category: { id: 3, name: 'Wellness', slug: 'wellness' }, images: ['https://images.pexels.com/photos/4465828/pexels-photo-4465828.jpeg?auto=compress&cs=tinysrgb&w=800'], new_arrival: true, featured: true, reviews: [], benefits: ['Daily wellness support', 'Herbal strength support', 'Traditional Ayurvedic blend'], ingredients: 'Amla, Guduchi, Ashwagandha', how_to_use: 'Use consistently for best results and pair with a balanced routine.', weight: '90 g' }
      ] });
    }

    const { category, featured, bestSeller, newArrival, search, limit, offset } = req.query;
    let query = supabase.from('products').select('*, category:categories(*)');

    if (category) {
      query = query.eq('category_id', category);
    }
    if (featured === 'true') {
      query = query.eq('featured', true);
    }
    if (bestSeller === 'true') {
      query = query.eq('best_seller', true);
    }
    if (newArrival === 'true') {
      query = query.eq('new_arrival', true);
    }
    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    if (limit) {
      query = query.limit(Number(limit));
    }
    if (offset) {
      query = query.range(Number(offset), Number(offset) + (Number(limit) || 19));
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) {
      throw error;
    }

    return res.json({ products: data || [] });
  } catch (error) {
    console.error('get-products error:', error);
    return res.status(500).json({ error: error.message || 'Unable to fetch products.' });
  }
});

app.get('/api/products/:slug', async (req, res) => {
  try {
    if (!supabase) {
      const product = [
        { id: 101, slug: 'vitamin-c-face-serum', name: 'Vitamin C Face Serum', short_description: 'Brightens skin and helps improve your glow naturally.', description: 'A lightweight, radiance-boosting serum infused with vitamin C and Ayurvedic botanicals for a fresh, healthy complexion.', price: 4599, compare_price: 5500, sku: 'DIVYAM-VC-001', stock_quantity: 24, category_id: 2, category: { id: 2, name: 'Skin Care', slug: 'skin-care' }, images: ['https://images.pexels.com/photos/3762875/pexels-photo-3762875.jpeg?auto=compress&cs=tinysrgb&w=800'], new_arrival: true, featured: true, reviews: [{ customer_name: 'Priya', rating: 5, review_text: 'Beautiful texture and visible glow.' }], benefits: ['Brightens skin tone', 'Supports collagen health', 'Lightweight everyday use'], ingredients: 'Vitamin C, Indian Gooseberry, Aloe Vera', how_to_use: 'Apply 2-3 drops to clean skin in the morning and follow with moisturizer.', weight: '30 ml' },
        { id: 102, slug: 'ashwagandha-capsules', name: 'Ashwagandha Capsules', short_description: 'A classic adaptogenic supplement for calm and resilience.', description: 'Ashwagandha capsules crafted to support stress balance, recovery, and everyday energy.', price: 3499, compare_price: 4200, sku: 'DIVYAM-AW-002', stock_quantity: 18, category_id: 3, category: { id: 3, name: 'Wellness', slug: 'wellness' }, images: ['https://images.pexels.com/photos/3822906/pexels-photo-3822906.jpeg?auto=compress&cs=tinysrgb&w=800'], new_arrival: false, featured: true, reviews: [{ customer_name: 'Rohan', rating: 5, review_text: 'Helps me stay balanced during busy days.' }], benefits: ['Supports stress resilience', 'Encourages calm focus', 'Daily wellness support'], ingredients: 'Ashwagandha root extract, natural capsule shell', how_to_use: 'Take one capsule twice daily with meals or as directed by your physician.', weight: '60 capsules' },
        { id: 103, slug: 'testostro-booster', name: 'TestoStron Booster', short_description: 'Herbal vitality support for strength and stamina.', description: 'A time-tested blend crafted to support strength, endurance, and overall masculine vitality.', price: 34099, compare_price: 42000, sku: 'DIVYAM-TS-003', stock_quantity: 9, category_id: 3, category: { id: 3, name: 'Wellness', slug: 'wellness' }, images: ['https://images.pexels.com/photos/4041391/pexels-photo-4041391.jpeg?auto=compress&cs=tinysrgb&w=800'], new_arrival: false, featured: true, reviews: [], benefits: ['Supports stamina', 'Builds everyday vitality', 'Herbal formulation'], ingredients: 'Shilajit, Safed Musli, Gokshura', how_to_use: 'Take one serving daily with warm water after meals.', weight: '100 g' },
        { id: 104, slug: 'natural-strength', name: 'Natural Strength', short_description: 'A nourishing herbal blend for overall strength and endurance.', description: 'An Ayurvedic herbal blend intended for daily wellness and strength support.', price: 34099, compare_price: 42000, sku: 'DIVYAM-NS-004', stock_quantity: 12, category_id: 3, category: { id: 3, name: 'Wellness', slug: 'wellness' }, images: ['https://images.pexels.com/photos/4465828/pexels-photo-4465828.jpeg?auto=compress&cs=tinysrgb&w=800'], new_arrival: true, featured: true, reviews: [], benefits: ['Daily wellness support', 'Herbal strength support', 'Traditional Ayurvedic blend'], ingredients: 'Amla, Guduchi, Ashwagandha', how_to_use: 'Use consistently for best results and pair with a balanced routine.', weight: '90 g' }
      ].find((item) => item.slug === req.params.slug);
      if (!product) {
        return res.status(404).json({ error: 'Product not found.' });
      }
      return res.json({ product });
    }

    const { slug } = req.params;
    const { data, error } = await supabase
      .from('products')
      .select('*, category:categories(*), reviews(*)')
      .eq('slug', slug)
      .single();

    if (error) {
      if (error.code === 'PGRST116' || error.code === 'PGRST117') {
        return res.status(404).json({ error: 'Product not found.' });
      }
      throw error;
    }

    return res.json({ product: data });
  } catch (error) {
    console.error('get-product-by-slug error:', error);
    return res.status(500).json({ error: error.message || 'Unable to fetch product.' });
  }
});

app.get('/api/admin/validate', (req, res) => {
  return res.json({
    ok: true,
    route: '/api/admin/validate',
    method: 'POST required for login',
    adminUserConfigured: Boolean(process.env.ADMIN_USER_ID),
    adminSecretConfigured: Boolean(process.env.ADMIN_SECRET),
  });
});

app.post('/api/admin/validate', (req, res) => {
  const { secret, userId } = req.body;

  if (!adminAccessGranted(secret, userId)) {
    return res.status(403).json({ valid: false, error: 'Invalid admin credentials. Use the ADMIN_USER_ID and ADMIN_SECRET from your active .env file.' });
  }

  return res.json({ valid: true, userId: getAdminCredentials().userId });
});

app.get('/api/admin/categories', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Server configuration is invalid. Check API env variables.' });
    }

    const { data, error } = await supabase.from('categories').select('id, name, slug').order('sort_order', { ascending: true });
    if (error) {
      throw error;
    }

    return res.json({ categories: data || [] });
  } catch (error) {
    console.error('get-admin-categories error:', error);
    return res.status(500).json({ error: error.message || 'Unable to fetch categories.' });
  }
});

app.get('/api/admin/products', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Server configuration is invalid. Check API env variables.' });
    }

    const { secret, userId } = req.query;
    if (!adminAccessGranted(secret, userId)) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    const { data, error } = await supabase
      .from('products')
      .select('*, category:categories(*)')
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return res.json({ products: data || [] });
  } catch (error) {
    console.error('admin-list-products error:', error);
    return res.status(500).json({ error: error.message || 'Unable to load products.' });
  }
});

app.post('/api/admin/products', upload.array('images'), async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Server configuration is invalid. Check API env variables.' });
    }

    const isMultipart = req.files && req.files.length > 0;
    const secret = req.body.secret || (req.body.product && req.body.product.secret);
    const userId = req.body.userId || (req.body.product && req.body.product.userId);

    console.log("BODY:", req.body);
    console.log("SECRET RECEIVED:", secret);
    console.log("USER RECEIVED:", userId);
    console.log("ENV SECRET:", process.env.ADMIN_SECRET);
    console.log("ENV USER:", process.env.ADMIN_USER_ID);

    if (!adminAccessGranted(secret, userId)) {
      return res.status(403).json({
        error: "Unauthorized.",
        receivedSecret: secret,
        receivedUser: userId,
        envSecret: process.env.ADMIN_SECRET,
        envUser: process.env.ADMIN_USER_ID
      });
    }

    const product = req.body.product ? (typeof req.body.product === 'string' ? JSON.parse(req.body.product) : req.body.product) : {
      name: req.body.name,
      slug: req.body.slug,
      description: req.body.description,
      short_description: req.body.short_description,
      price: req.body.price,
      compare_price: req.body.compare_price,
      sku: req.body.sku,
      stock_quantity: req.body.stock_quantity,
      weight: req.body.weight,
      category_id: req.body.category_id,
      images: [],
      featured: req.body.featured === 'true' || req.body.featured === true,
      best_seller: req.body.best_seller === 'true' || req.body.best_seller === true,
      new_arrival: req.body.new_arrival === 'true' || req.body.new_arrival === true,
      ingredients: req.body.ingredients,
      how_to_use: req.body.how_to_use,
      benefits: req.body.benefits,
      meta_title: req.body.meta_title,
      meta_description: req.body.meta_description,
    };

    if ((!product || !product.name || !product.slug || !product.price) && !(req.files && req.body.name)) {
      return res.status(400).json({ error: 'Product name, slug, and price are required.' });
    }

    const processedImages = [];
    if (isMultipart) {
      for (const f of req.files) {
        processedImages.push(`/images/products/${f.filename}`);
      }
    }

    if (req.body.images_urls) {
      const urls = String(req.body.images_urls).split(',').map((s) => s.trim()).filter(Boolean);
      processedImages.push(...urls);
    }

    const imageArray = normalizeImages(product.images);
    for (const img of imageArray) {
      if (typeof img === 'string' && img.startsWith('data:')) {
        const saved = await saveDataUrlImage(img);
        if (saved) processedImages.push(saved);
      } else if (img) {
        processedImages.push(img);
      }
    }

    const insertPayload = buildProductPayload(product, processedImages);

    const { data, error } = await supabase.from('products').insert(insertPayload).select().single();
    if (error) {
      throw error;
    }

    return res.json({ product: data });
  } catch (error) {
    console.error('admin-create-product error:', error);
    return res.status(500).json({ error: error.message || 'Unable to create product.' });
  }
});

app.put('/api/admin/products/:id', upload.array('images'), async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Server configuration is invalid. Check API env variables.' });
    }

    const { id } = req.params;
    const secret = req.body.secret || (req.body.product && req.body.product.secret);
    const userId = req.body.userId || (req.body.product && req.body.product.userId);

    if (!adminAccessGranted(secret, userId)) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    const product = req.body.product ? (typeof req.body.product === 'string' ? JSON.parse(req.body.product) : req.body.product) : {
      name: req.body.name,
      slug: req.body.slug,
      description: req.body.description,
      short_description: req.body.short_description,
      price: req.body.price,
      compare_price: req.body.compare_price,
      sku: req.body.sku,
      stock_quantity: req.body.stock_quantity,
      weight: req.body.weight,
      category_id: req.body.category_id,
      images: req.body.images,
      featured: req.body.featured === 'true' || req.body.featured === true,
      best_seller: req.body.best_seller === 'true' || req.body.best_seller === true,
      new_arrival: req.body.new_arrival === 'true' || req.body.new_arrival === true,
      ingredients: req.body.ingredients,
      how_to_use: req.body.how_to_use,
      benefits: req.body.benefits,
      meta_title: req.body.meta_title,
      meta_description: req.body.meta_description,
    };

    const processedImages = [];
    if (req.files && req.files.length > 0) {
      for (const f of req.files) {
        processedImages.push(`/images/products/${f.filename}`);
      }
    }

    if (req.body.images_urls) {
      const urls = String(req.body.images_urls).split(',').map((s) => s.trim()).filter(Boolean);
      processedImages.push(...urls);
    }

    const imageArray = normalizeImages(product.images);
    for (const img of imageArray) {
      if (typeof img === 'string' && img.startsWith('data:')) {
        const saved = await saveDataUrlImage(img);
        if (saved) processedImages.push(saved);
      } else if (img) {
        processedImages.push(img);
      }
    }

    const updatePayload = buildProductPayload(product, processedImages);

    const { data, error } = await supabase.from('products').update(updatePayload).eq('id', id).select().single();
    if (error) {
      throw error;
    }

    return res.json({ product: data });
  } catch (error) {
    console.error('admin-update-product error:', error);
    return res.status(500).json({ error: error.message || 'Unable to update product.' });
  }
});

app.delete('/api/admin/products/:id', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Server configuration is invalid. Check API env variables.' });
    }

    const { id } = req.params;
    const { secret, userId } = req.query;

    if (!adminAccessGranted(secret, userId)) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) {
      throw error;
    }

    return res.json({ success: true, message: 'Product deleted successfully.' });
  } catch (error) {
    console.error('admin-delete-product error:', error);
    return res.status(500).json({ error: error.message || 'Unable to delete product.' });
  }
});

app.get('/api/admin/orders', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Server configuration is invalid. Check API env variables.' });
    }

    const { secret, userId } = req.query;
    if (!adminAccessGranted(secret, userId)) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(150);

    if (error) {
      throw error;
    }

    const orders = await attachOrderItems(data || []);
    return res.json({ orders });
  } catch (error) {
    console.error('admin-get-orders error:', error);
    return res.status(500).json({ error: error.message || 'Unable to fetch orders.' });
  }
});

app.post('/api/admin/orders', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Server configuration is invalid. Check API env variables.' });
    }

    const { secret, userId, order } = req.body;
    if (!adminAccessGranted(secret, userId)) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    if (!order?.customer_name || !order?.customer_phone || !order?.total_amount) {
      return res.status(400).json({ error: 'Customer name, phone, and total amount are required.' });
    }

    const insertPayload = {
      session_id: `manual-${Date.now()}`,
      total_amount: Number(order.total_amount) || 0,
      customer_email: order.customer_email || null,
      customer_name: order.customer_name,
      customer_phone: order.customer_phone,
      shipping_address: {
        address: order.address || '',
        city: order.city || '',
        state: order.state || '',
        zip: order.zip || '',
      },
      notes: order.notes || '',
      payment_method: order.payment_method || 'manual',
      payment_status: order.payment_status || 'pending',
      shiprocket_order_id: order.shiprocket_order_id || null,
      shiprocket_status: order.shiprocket_status || 'created',
    };

    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .insert(insertPayload)
      .select()
      .single();

    if (orderError) {
      throw orderError;
    }

    const itemPayload = (order.items || [])
      .filter((item) => item.product_name)
      .map((item) => ({
        order_id: orderData.id,
        product_id: item.product_id || null,
        product_name: item.product_name,
        product_price: Number(item.product_price) || 0,
        quantity: Number(item.quantity) || 1,
      }));

    if (itemPayload.length > 0) {
      const { error: itemsError } = await supabase.from('order_items').insert(itemPayload);
      if (itemsError) {
        console.warn('Manual order created but order items were not saved:', itemsError.message);
      }
    }

    const [createdOrder] = await attachOrderItems([orderData]);
    return res.json({ order: createdOrder });
  } catch (error) {
    console.error('admin-create-order error:', error);
    return res.status(500).json({ error: error.message || 'Unable to create order.' });
  }
});

app.patch('/api/admin/orders/:id/tracking', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Server configuration is invalid. Check API env variables.' });
    }

    const { secret, userId, updates = {} } = req.body;
    if (!adminAccessGranted(secret, userId)) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    const updatePayload = {};
    if (updates.payment_status !== undefined) updatePayload.payment_status = updates.payment_status;
    if (updates.shiprocket_status !== undefined) updatePayload.shiprocket_status = updates.shiprocket_status;
    if (updates.shiprocket_order_id !== undefined) updatePayload.shiprocket_order_id = updates.shiprocket_order_id || null;
    if (updates.notes !== undefined) updatePayload.notes = updates.notes || '';

    if (Object.keys(updatePayload).length === 0) {
      return res.status(400).json({ error: 'No tracking update provided.' });
    }

    const { data, error } = await supabase
      .from('orders')
      .update(updatePayload)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    const [order] = await attachOrderItems([data]);
    return res.json({ order });
  } catch (error) {
    console.error('admin-update-order-tracking error:', error);
    return res.status(500).json({ error: error.message || 'Unable to update order tracking.' });
  }
});

app.delete('/api/admin/orders/:id', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Server configuration is invalid. Check API env variables.' });
    }

    const { secret, userId } = req.body;
    if (!adminAccessGranted(secret, userId)) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    await supabase.from('order_items').delete().eq('order_id', req.params.id);

    const { error } = await supabase
      .from('orders')
      .delete()
      .eq('id', req.params.id);

    if (error) {
      throw error;
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('admin-delete-order error:', error);
    return res.status(500).json({ error: error.message || 'Unable to delete order.' });
  }
});

app.get('/api/orders/track', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Server configuration is invalid. Check API env variables.' });
    }

    const { orderId, phone } = req.query;
    if (!orderId || !phone) {
      return res.status(400).json({ error: 'Order ID and phone number are required.' });
    }

    const cleanOrderId = String(orderId).trim();
    const cleanPhone = String(phone).trim();

    let order = null;

    if (/^\d+$/.test(cleanOrderId)) {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('id', Number(cleanOrderId))
        .eq('customer_phone', cleanPhone)
        .limit(1);

      if (error) {
        throw error;
      }

      order = data?.[0] || null;
    }

    if (!order) {
      const trackingFields = ['shiprocket_order_id', 'razorpay_order_id'];
      for (const field of trackingFields) {
        const { data, error } = await supabase
          .from('orders')
          .select('*')
          .eq(field, cleanOrderId)
          .eq('customer_phone', cleanPhone)
          .limit(1);

        if (error) {
          throw error;
        }

        if (data?.[0]) {
          order = data[0];
          break;
        }
      }
    }

    if (!order) {
      return res.status(404).json({ error: 'Order not found. Please check order ID and phone number.' });
    }

    const [orderWithItems] = await attachOrderItems([order]);
    return res.json({ order: orderWithItems });
  } catch (error) {
    console.error('track-order error:', error);
    return res.status(500).json({ error: error.message || 'Unable to track order.' });
  }
});

app.post('/api/payment/verify-payment', async (req, res) => {
  try {
    if (!razorpay || !supabase) {
      return res.status(500).json({ error: 'Server configuration is invalid. Check API env variables.' });
    }

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderDbId,
      formData,
      cartItems,
      shipping,
      total,
      selectedPaymentMethod,
      sessionId,
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !orderDbId) {
      return res.status(400).json({ error: 'Payment response is incomplete.' });
    }

    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment signature verification failed.' });
    }

    const { data: orderData, error: orderFetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderDbId)
      .single();

    if (orderFetchError || !orderData) {
      throw orderFetchError || new Error('Order not found.');
    }

    const { error: orderUpdateError } = await supabase
      .from('orders')
      .update({
        payment_status: 'paid',
        payment_gateway: 'razorpay',
        razorpay_payment_id,
        razorpay_order_id,
      })
      .eq('id', orderData.id);

    if (orderUpdateError) {
      throw orderUpdateError;
    }

    const orderItems = cartItems.map((item) => ({
      order_id: orderData.id,
      product_id: item.product_id,
      product_name: item.product_name,
      product_price: item.product_price,
      quantity: item.quantity,
    }));

    const { error: itemsError } = await supabase.from('order_items').insert(orderItems);
    if (itemsError) {
      throw itemsError;
    }

    const shiprocketResponse = await sendShiprocketOrder(orderData, formData, cartItems, shipping, total);
    if (shiprocketResponse?.shiprocketOrderId) {
      await supabase
        .from('orders')
        .update({ shiprocket_order_id: shiprocketResponse.shiprocketOrderId, shiprocket_status: shiprocketResponse.status || 'created' })
        .eq('id', orderData.id);
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('verify-payment error:', error);
    return res.status(500).json({ error: error.message || 'Payment verification failed.' });
  }
});

// Health Check
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Divyam Backend API is running"
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    path: req.path
  });
});

app.listen(port, () => {
  console.log(`Payment API server listening on http://localhost:${port}`);
});