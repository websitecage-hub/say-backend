const express = require('express');
const Razorpay = require('razorpay');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();

/**
 * ── RAZORPAY BACKEND SERVER ──────────────────────────
 * Handles secure order creation for the frontend checkout.
 * ─────────────────────────────────────────────────── */

// 1. Middleware
app.use(cors({ origin: "*" }));
app.use(bodyParser.json());

const BACKEND_URL = process.env.BACKEND_URL || "https://say-backend-ux5j.onrender.com";

// 2. Razorpay Instance Configuration
// CRITICAL: Keep Key Secret in .env only. Never expose in frontend.
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// 2.5 Supabase Instance Configuration
const { createClient } = require('@supabase/supabase-js');
let supabase = null;

try {
  const url = process.env.SUPABASE_URL || '';
  if (url.startsWith('http://') || url.startsWith('https://')) {
    supabase = createClient(url, process.env.SUPABASE_KEY);
  } else {
    console.error("⚠️ WARN: Invalid SUPABASE_URL in .env. Supabase is DISABLED.");
  }
} catch (err) {
  console.error("⚠️ WARN: Failed to initialize Supabase:", err.message);
}

// 2.6 NodeMailer Configuration
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const sendEbookEmail = async (toEmail, toName, token) => {
  try {
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; color: #111; line-height: 1.6; max-width: 600px;">
        <p>Hi ${toName},</p>
        <p>Your payment was successful — your access has been unlocked.</p>
        <p>You can securely download your ebook using the button below:</p>
        <br><br>
        <a href="${BACKEND_URL}/download?token=${token}" style="display:inline-block;padding:14px 22px;background:#000;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;">
          Download Your Ebook
        </a>
        <br><br>
        <p>If the button doesn’t work, use this link:</p>
        <p><a href="${BACKEND_URL}/download?token=${token}">${BACKEND_URL}/download?token=${token}</a></p>
        <br><br>
        <p><strong>Important:</strong></p>
        <p>This link is unique to you. Please do not share it.<br>Access may be limited to ensure secure delivery.</p>
        <br><br>
        <p><strong>Before you read:</strong></p>
        <p>Don’t rush this.</p>
        <p>This isn’t about consuming information —<br>it’s about seeing clearly.</p>
        <p>Take your time with it.</p>
        <br><br>
        <p>— Unleash The Beast</p>
      </div>
    `;

    const mailOptions = {
      from: `"Unleash The Beast" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: "Your Ebook is Ready",
      html: htmlBody
    };
    const info = await transporter.sendMail(mailOptions);
    console.log(`📧 EMAIL SENT: Delivered to ${toEmail} | ID: ${info.messageId}`);
  } catch (err) {
    console.error(`❌ EMAIL FAILED: Could not send to ${toEmail}`, err.message);
  }
};

// 3. API Endpoints
/**
 * @route   POST /create-order
 * @desc    Generates a unique Razorpay Order ID
 * @access  Public (should be protected in production)
 */
app.post('/create-order', async (req, res) => {
  try {
    const { amount } = req.body;
    
    // Validate input
    if (!amount) {
      return res.status(400).json({ 
        success: false, 
        message: "Amount is required (in paise)" 
      });
    }

    // Razorpay Order Options
    const options = {
      amount: parseInt(amount), // Amount in paise (e.g. 100 = ₹1)
      currency: "INR",
      receipt: `receipt_tb_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    };

    console.log(`🔄 Creating order for: ${amount} paise...`);

    // Create Order via Razorpay SDK
    const order = await razorpay.orders.create(options);

    if (!order) {
      return res.status(500).json({ 
        success: false, 
        message: "Internal server error during order creation" 
      });
    }

    // Return the generated order_id to frontend
    res.status(200).json({
      success: true,
      order_id: order.id
    });

  } catch (error) {
    console.error("❌ Razorpay API Error:", error);
    res.status(500).json({
      success: false,
      message: "Razorpay order creation failed. Check credentials.",
      error: error.description || error.message
    });
  }
});

/**
 * @route   POST /api/leads
 * @desc    Captures potential buyer information (Name, Email, Mobile)
 * @access  Public
 */
app.post('/api/leads', (req, res) => {
  try {
    const { name, email, mobile } = req.body;
    console.log(`📝 NEW LEAD CAPTURED: ${name} (${email}) - ${mobile}`);
    
    // For now, we'll just log it. In production, save to DB.
    res.status(200).json({ success: true, message: "Lead captured successfully" });
  } catch (error) {
    console.error("❌ Lead Capture Error:", error);
    res.status(500).json({ success: true }); // Silent fail for UI sake
  }
});

/**
 * @route   POST /save-user
 * @desc    Stores user data in Supabase with pending status
 * @access  Public
 */
app.post('/save-user', async (req, res) => {
  try {
    const { name, email, phone, order_id } = req.body;
    
    const { data, error } = await supabase
      .from('buyers')
      .insert([{
        name,
        email,
        phone,
        order_id,
        payment_status: 'pending' // Default status upon order creation
      }]);
      
    if (error) throw error;
    
    console.log(`👤 USER SAVED TO DATABASE: ${email}`);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error("❌ Database Save Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @route   POST /update-payment
 * @desc    Updates user payment status to success in Supabase
 * @access  Public
 */
app.post('/update-payment', async (req, res) => {
  try {
    const { order_id, payment_id } = req.body;
    
    const { data, error } = await supabase
      .from('buyers')
      .update({ 
        payment_status: 'success',
        payment_id: payment_id
      })
      .eq('order_id', order_id)
      .select();
      
    if (error) throw error;

    console.log(`🎯 DATABASE UPDATED -> Order: ${order_id} marked as SUCCESS`);

    // 📧 Fire Automated Email if user exists
    if (data && data.length > 0) {
      // Fire Automated Email in background
      sendEbookEmail(user.email, user.name || "Reader", order_id).catch(err => console.error("Background Email Error:", err));
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("❌ Database Update Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @route   POST /verify-payment
 * @desc    Securely verifies Razorpay payment signature
 * @access  Public
 */
const crypto = require('crypto');
app.post('/verify-payment', (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // Generate Expected Signature: HMAC SHA256(order_id + "|" + payment_id, secret_key)
    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest("hex");

    // 🔍 Debug Logs
    console.log("───────────────────────────────────────────────────");
    console.log("💳 VERIFICATION REQUEST RECEIVED");
    console.log("ORDER ID:", razorpay_order_id);
    console.log("PAYMENT ID:", razorpay_payment_id);
    console.log("SIGNATURE:", razorpay_signature);
    console.log("EXPECTED:", expectedSignature);
    console.log("───────────────────────────────────────────────────");

    // Atomic comparison of signatures
    if (razorpay_signature === expectedSignature) {
      console.log(`✅ PAYMENT VERIFIED ACCURATELY: ${razorpay_payment_id}`);
      return res.status(200).json({ 
        success: true, 
        message: "Payment verified successfully" 
      });
    } else {
      console.error("❌ SECURITY ALERT: Invalid Signature Processed!");
      return res.status(400).json({ 
        success: false, 
        message: "Payment verification failed. Invalid signature." 
      });
    }

  } catch (error) {
    console.error("❌ Internal Verification Crash:", error);
    res.status(500).json({ 
      success: false, 
      message: "Internal server error during verification" 
    });
  }
});

/**
 * @route   GET /download
 * @desc    Securely serves the ebook after validating the token
 * @access  Public (Validated)
 */
app.get('/download', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).send("<h1>Access Denied: Missing Token</h1>");
    }

    // Verify token (order_id) and payment_status in Supabase
    const { data, error } = await supabase
      .from('buyers')
      .select('payment_status')
      .eq('order_id', token)
      .single();

    if (error || !data) {
      console.error("❌ Download attempt blocked: Invalid Token.");
      return res.status(403).send("<h1>Access Denied: Invalid Link</h1>");
    }

    if (data.payment_status !== 'success') {
      console.error("❌ Download attempt blocked: Unverified Payment.");
      return res.status(403).send("<h1>Access Denied: Payment Not Verified</h1>");
    }

    // Success! Redirect to the secure ebook source
    const downloadUrl = "https://drive.google.com/uc?export=download&id=1cOpMSnV5Uws9P6sK0owuWTtBHk6hPh_k";
    console.log(`✅ DOWNLOAD AUTHORIZED: Token ${token} verified.`);
    res.redirect(downloadUrl);

  } catch (error) {
    console.error("❌ Error during secure download:", error);
    res.status(500).send("<h1>Internal Server Error: Accessing download...</h1>");
  }
});

// 4. Server Listener
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('───────────────────────────────────────────────────');
  console.log(`🚀 UNLEASH THE BEAST - BACKEND INITIALIZED`);
  console.log(`📡 Server running on: http://localhost:${PORT}`);
  console.log(`🔑 Connected with Key: ${process.env.RAZORPAY_KEY_ID}`);
  console.log('───────────────────────────────────────────────────');
});
