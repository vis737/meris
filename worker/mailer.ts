/**
 * MERIS E-SHOP — Resend mail service for the Cloudflare Worker.
 *
 * Replaces the old nodemailer SMTP stack entirely: Workers cannot open raw TCP
 * connections to SMTP servers, so every transactional email (OTP codes, order
 * confirmations, admin/vendor order alerts, payment approvals/rejections,
 * welcome messages and admin test emails) is dispatched through Resend's
 * HTTPS API — https://api.resend.com/emails.
 */
import { escapeHtml, sanitizeEmail, sanitizeString, isConfigured } from './utils';
import type { Env } from './env';

export interface EmailLogRecord {
  id: string;
  recipient: string;
  subject: string;
  bodyHtml: string;
  sentAt: string;
  orderNumber: string;
  status: string;
  dateText: string;
}

function formatFrom(env: Env): string {
  const fromName = env.APP_NAME || 'Meris E-Shop';
  const rawFrom = (env.RESEND_FROM_EMAIL || '').trim();
  if (!rawFrom) return 'onboarding@resend.dev';
  // Accept either "Name <email>" or a bare email address.
  if (rawFrom.includes('<')) return rawFrom;
  return `${fromName} <${rawFrom}>`;
}

/** Persist an email record to the Supabase email_logs table (best-effort). */
async function logEmailToSupabase(env: Env, record: EmailLogRecord): Promise<void> {
  const { getSupabase } = await import('./db');
  const supabase = getSupabase(env);
  if (!supabase) return;
  try {
    await supabase.from('email_logs').insert({
      id: record.id,
      recipient: record.recipient,
      subject: record.subject,
      body_html: record.bodyHtml,
      sent_at: record.sentAt,
      order_number: record.orderNumber,
      status: record.status,
      date_text: record.dateText,
    });
  } catch (err) {
    console.error('[Mailer] Supabase email_logs insert failed:', err);
  }
}

export function resendConfigured(env: Env): boolean {
  return isConfigured(env.RESEND_API_KEY);
}

/**
 * Send an email through Resend. Returns true when Resend accepted the message.
 * Also logs the message into the Supabase email_logs table (visible in the
 * admin panel's email log viewer).
 */
export async function sendEmail(env: Env, to: string, subject: string, html: string, orderNumber = 'SYSTEM'): Promise<boolean> {
  const recipient = sanitizeEmail(to);
  if (!recipient) {
    console.warn('[Mailer] Invalid recipient email, skipping dispatch.');
    return false;
  }

  const record: EmailLogRecord = {
    id: `email_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    recipient,
    subject,
    bodyHtml: html,
    sentAt: new Date().toLocaleString(),
    orderNumber,
    status: 'Delivered',
    dateText: new Date().toLocaleString(),
  };

  if (!resendConfigured(env)) {
    console.warn(`[Mailer] RESEND_API_KEY not configured — email to ${recipient} skipped (logged only).`);
    record.status = 'Skipped (no API key)';
    await logEmailToSupabase(env, record);
    return false;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY!.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: formatFrom(env),
        to: [recipient],
        subject,
        html,
      }),
    });

    const data: any = await response.json().catch(() => ({}));
    if (response.ok && data.id) {
      console.log(`[Mailer] Email delivered to ${recipient} via Resend (ID: ${data.id}).`);
      record.status = 'Delivered';
      await logEmailToSupabase(env, record);
      return true;
    }

    console.warn(`[Mailer] Resend rejected email to ${recipient}:`, data);
    record.status = `Failed: ${data?.message || response.status}`;
    await logEmailToSupabase(env, record);
    return false;
  } catch (err: any) {
    console.error('[Mailer] Resend dispatch exception:', err?.message || err);
    record.status = 'Failed: exception';
    await logEmailToSupabase(env, record);
    return false;
  }
}

/* ---------------------------------------------------------------------------
 * Shared template fragments
 * ------------------------------------------------------------------------- */

function brandHeader(badgeColor = '#f59e0b'): string {
  return `
    <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 36px 24px; text-align: center; border-bottom: 4px solid ${badgeColor};">
      <h1 style="color: #f59e0b; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: 3px;">MERIS</h1>
      <p style="color: #94a3b8; margin: 6px 0 0 0; font-size: 11px; letter-spacing: 3px; text-transform: uppercase; font-weight: 600;">Handcrafted Toys &amp; Premium Gifts</p>
    </div>`;
}

function brandFooter(): string {
  return `
    <div style="background-color: #f8fafc; border-top: 1px solid #f1f5f9; padding: 24px; text-align: center;">
      <p style="font-size: 11px; color: #94a3b8; margin: 0;">
        Meris Artisanal Studio Co. &bull; Handcrafted in Tamil Nadu Workshops, India
      </p>
    </div>`;
}

function emailShell(subject: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px 0; -webkit-font-smoothing: antialiased;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 15px -3px rgba(15, 23, 42, 0.05);">
    ${bodyHtml}
  </div>
</body>
</html>`;
}

/* ---------------------------------------------------------------------------
 * 1. OTP verification code
 * ------------------------------------------------------------------------- */

export async function sendOtpEmail(env: Env, email: string, code: string): Promise<boolean> {
  const subject = 'Your Meris verification code';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 16px;">
      <h2 style="margin: 0 0 12px; color: #0f172a;">Meris verification code</h2>
      <p style="color: #475569; font-size: 14px;">Use this code to sign in to your Meris account. It is valid for 5 minutes.</p>
      <div style="font-size: 32px; letter-spacing: 8px; font-weight: 700; color: #c5a021; padding: 18px 0;">${escapeHtml(code)}</div>
      <p style="color: #64748b; font-size: 12px;">If you did not request this code, no action is needed.</p>
    </div>
  `;
  return sendEmail(env, email, subject, html, 'OTP_LOGIN');
}

/* ---------------------------------------------------------------------------
 * 2. Customer order confirmation
 * ------------------------------------------------------------------------- */

export async function sendBookingEmail(env: Env, order: any): Promise<EmailLogRecord | null> {
  try {
    const recipientEmail = sanitizeEmail(order.customerInfo?.email || order.accountEmail || order.email);
    if (!recipientEmail) {
      console.warn('[Mailer] No valid customer recipient for order:', order?.orderNumber);
      return null;
    }
    const customerName = sanitizeString(order.customerInfo?.name || order.accountName || order.name || 'Valued Customer', 100);
    const orderNum = order.orderNumber || order.id || 'ORDER';
    const subject = `Order Confirmation - Meris E-Shop (#${orderNum})`;

    let itemsHtml = '';
    if (order.items && Array.isArray(order.items)) {
      order.items.forEach((item: any) => {
        const productObj = item.product || item;
        const productName = escapeHtml(productObj.name || 'Handcrafted Gift');
        const qty = Number(item.quantity || 1);
        const price = Number(productObj.discountPrice ?? productObj.price ?? item.price ?? 0);
        const imageUrl = (Array.isArray(productObj.images) && productObj.images[0])
          ? productObj.images[0]
          : 'https://images.unsplash.com/photo-1531403009284-440f080d1e12?w=150&auto=format&fit=crop&q=80';

        itemsHtml += `
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 12px 8px; width: 60px;">
              <img src="${escapeHtml(imageUrl)}" alt="${productName}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 8px; border: 1px solid #e2e8f0;" />
            </td>
            <td style="padding: 12px 8px; font-size: 13px; color: #0f172a; font-weight: 500;">
              ${productName}
              <div style="font-size: 11px; color: #64748b; font-family: monospace; margin-top: 2px;">Qty: ${qty} × ₹${price}</div>
            </td>
            <td style="padding: 12px 8px; text-align: right; font-size: 13px; font-family: monospace; font-weight: bold; color: #0f172a;">
              ₹${price * qty}
            </td>
          </tr>`;
      });
    }

    const subtotal = Number(order.subtotal || 0);
    const discount = Number(order.discount || 0);
    const shippingCost = Number(order.shippingCost || 0);
    const tax = Number(order.tax || 0);
    const total = Number(order.total || 0);
    const paymentMethod = escapeHtml(order.paymentMethod || 'Online Payment');
    const paymentStatus = escapeHtml((order.paymentStatus || 'PAID').toUpperCase());

    const html = emailShell(subject, `
    ${brandHeader()}
    <div style="padding: 32px 24px 20px 24px;">
      <h2 style="font-size: 18px; color: #0f172a; margin-top: 0; margin-bottom: 12px; font-weight: 600;">Dear ${escapeHtml(customerName)},</h2>
      <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0;">
        Thank you for choosing <strong>Meris E-Shop</strong>. We are thrilled to confirm that your artisanal booking is officially registered under our workshop ledger. Our master craftspeople are preparing your order right now inside our certified cottage works.
      </p>
    </div>
    <div style="padding: 0 24px;">
      <div style="background-color: #f1f5f9; border-radius: 14px; padding: 18px; border: 1px dashed #cbd5e1;">
        <table style="width: 100%; border-collapse: collapse; font-size: 12px; font-family: monospace;">
          <tr>
            <td style="color: #64748b; padding-bottom: 6px; font-weight: bold;">ORDER NUMBER:</td>
            <td style="color: #0f172a; text-align: right; padding-bottom: 6px; font-weight: bold; font-size: 13px;">${escapeHtml(orderNum)}</td>
          </tr>
          <tr>
            <td style="color: #64748b; padding-bottom: 6px; font-weight: bold;">BOOKING DATE:</td>
            <td style="color: #0f172a; text-align: right; padding-bottom: 6px;">${escapeHtml(order.date || new Date().toLocaleDateString())}</td>
          </tr>
          <tr>
            <td style="color: #64748b; padding-bottom: 6px; font-weight: bold;">PAYMENT GATEWAY:</td>
            <td style="color: #0f172a; text-align: right; padding-bottom: 6px;">${paymentMethod} (${paymentStatus})</td>
          </tr>
          <tr>
            <td style="color: #64748b; font-weight: bold;">LOGISTICS MODE:</td>
            <td style="color: #d97706; text-align: right; font-weight: bold;">${order.shippingMethod === 'express' ? 'BlueDart Air Express (2-3 Days)' : 'Standard Ground Delivery'}</td>
          </tr>
        </table>
      </div>
    </div>
    <div style="padding: 24px;">
      <h3 style="font-size: 13px; text-transform: uppercase; letter-spacing: 1.5px; color: #0f172a; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px; margin-top: 0; margin-bottom: 12px; font-weight: 700;">Package Summary</h3>
      <table style="width: 100%; border-collapse: collapse; text-align: left;">
        <thead>
          <tr style="border-bottom: 2px solid #e2e8f0;">
            <th style="padding-bottom: 8px; font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: bold; width: 60px;">Product</th>
            <th style="padding-bottom: 8px; font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: bold;">Description</th>
            <th style="padding-bottom: 8px; font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: bold; text-align: right;">Amount</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
    </div>
    <div style="padding: 0 24px 24px 24px;">
      <table style="width: 100%; border-collapse: collapse; font-size: 13px; color: #475569;">
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Subtotal:</td>
          <td style="padding: 6px 0; text-align: right; font-family: monospace; color: #0f172a;">₹${subtotal}</td>
        </tr>
        ${discount > 0 ? `
        <tr>
          <td style="padding: 6px 0; color: #10b981; font-weight: 500;">Campaign Promo Discount (${escapeHtml(order.couponCode || 'PROMO')}):</td>
          <td style="padding: 6px 0; text-align: right; font-family: monospace; color: #10b981; font-weight: bold;">-₹${discount}</td>
        </tr>` : ''}
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Shipping Handlers Fee:</td>
          <td style="padding: 6px 0; text-align: right; font-family: monospace; color: #0f172a;">₹${shippingCost}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Tax (Inclusive Goods &amp; Services Tax):</td>
          <td style="padding: 6px 0; text-align: right; font-family: monospace; color: #0f172a;">₹${tax}</td>
        </tr>
        <tr style="border-top: 1px solid #e2e8f0;">
          <td style="padding: 16px 0 0 0; font-size: 15px; font-weight: bold; color: #0f172a;">Total Invoice Paid:</td>
          <td style="padding: 16px 0 0 0; text-align: right; font-size: 16px; font-weight: bold; color: #d97706; font-family: monospace;">₹${total}</td>
        </tr>
      </table>
    </div>
    <div style="background-color: #f8fafc; border-top: 1px solid #f1f5f9; padding: 24px; text-align: center;">
      <p style="font-size: 12px; color: #64748b; margin: 0 0 8px 0; line-height: 1.5;">
        Your dispatch tracking number is active. You can track this booking live in your Meris Account Dashboard anytime.
      </p>
      ${brandFooter()}
    </div>`);

    await sendEmail(env, recipientEmail, subject, html, orderNum);
    return {
      id: `email_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      recipient: recipientEmail,
      subject,
      bodyHtml: html,
      sentAt: new Date().toLocaleString(),
      orderNumber: orderNum,
      status: 'Delivered',
      dateText: new Date().toLocaleString(),
    };
  } catch (err) {
    console.error('[Mailer] Exception in sendBookingEmail:', err);
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * 3. Admin + vendor new-order alert
 * ------------------------------------------------------------------------- */

export async function sendAdminVendorNotificationEmail(env: Env, order: any): Promise<void> {
  try {
    const orderNum = order.orderNumber || order.id || 'ORDER';
    const customerName = sanitizeString(order.customerInfo?.name || order.accountName || 'Customer', 100);
    const customerEmail = sanitizeEmail(order.customerInfo?.email || order.accountEmail || '');
    const customerPhone = sanitizeString(order.customerInfo?.phone || '', 30);
    const customerAddress = sanitizeString(order.customerInfo?.address || '', 300);
    const customerPincode = sanitizeString(order.customerInfo?.pincode || '', 10);

    const adminEmail = sanitizeEmail(env.ADMIN_NOTIFICATION_EMAIL || '');
    const subject = `New Order Received - Meris E-Shop (#${orderNum})`;

    let itemsHtml = '';
    if (order.items && Array.isArray(order.items)) {
      order.items.forEach((item: any) => {
        const productObj = item.product || item;
        const productName = escapeHtml(productObj.name || 'Handcrafted Product');
        const qty = Number(item.quantity || 1);
        const price = Number(productObj.discountPrice ?? productObj.price ?? item.price ?? 0);
        const vendorId = escapeHtml(productObj.vendorId || item.vendorId || 'Store Direct');

        itemsHtml += `
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px; font-size: 13px; color: #0f172a; font-weight: 500;">
              ${productName}
              <div style="font-size: 11px; color: #64748b;">Listing / Vendor: ${vendorId} | Qty: ${qty} × ₹${price}</div>
            </td>
            <td style="padding: 10px; text-align: right; font-size: 13px; font-family: monospace; font-weight: bold; color: #0f172a;">
              ₹${price * qty}
            </td>
          </tr>`;
      });
    }

    const total = Number(order.total || 0);
    const paymentMethod = escapeHtml(order.paymentMethod || 'Online Payment');
    const paymentStatus = escapeHtml((order.paymentStatus || 'unpaid').toUpperCase());

    const html = emailShell(subject, `
    <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 24px; text-align: center; border-bottom: 4px solid #10b981;">
      <h1 style="color: #10b981; margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 2px;">NEW ORDER ALERT</h1>
      <p style="color: #94a3b8; margin: 4px 0 0 0; font-size: 12px;">Meris E-Shop Store &amp; Listing Notification</p>
    </div>
    <div style="padding: 24px;">
      <h2 style="font-size: 16px; color: #0f172a; margin-top: 0;">Order #${escapeHtml(orderNum)} has been placed!</h2>
      <p style="font-size: 13px; color: #475569; margin: 0 0 16px 0;">A customer has purchased items from your catalog listings. Please review order details below for fulfillment.</p>
      <div style="background-color: #f1f5f9; border-radius: 10px; padding: 14px; margin-bottom: 20px; font-size: 12px; color: #334155;">
        <h3 style="margin: 0 0 8px 0; font-size: 13px; color: #0f172a; text-transform: uppercase;">Customer Details</h3>
        <div><strong>Name:</strong> ${escapeHtml(customerName)}</div>
        <div><strong>Email:</strong> ${escapeHtml(customerEmail)}</div>
        <div><strong>Phone:</strong> ${escapeHtml(customerPhone || 'N/A')}</div>
        <div><strong>Shipping Address:</strong> ${escapeHtml(customerAddress)} (Pincode: ${escapeHtml(customerPincode)})</div>
        <div><strong>Payment Method:</strong> ${paymentMethod} (${paymentStatus})</div>
      </div>
      <h3 style="font-size: 13px; color: #0f172a; text-transform: uppercase; margin-bottom: 8px;">Order Items</h3>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
        <thead>
          <tr style="border-bottom: 2px solid #e2e8f0; text-align: left; font-size: 11px; color: #64748b;">
            <th style="padding: 6px 10px;">Item / Listing</th>
            <th style="padding: 6px 10px; text-align: right;">Total</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <div style="text-align: right; font-size: 15px; font-weight: bold; color: #0f172a; padding-top: 8px; border-top: 1px solid #e2e8f0;">
        Grand Total: <span style="color: #d97706; font-family: monospace;">₹${total}</span>
      </div>
    </div>
    <div style="background-color: #f8fafc; border-top: 1px solid #f1f5f9; padding: 16px; text-align: center; font-size: 11px; color: #94a3b8;">
      Meris Artisanal Studio Co. Automated Merchant Dispatch Notification
    </div>`);

    if (adminEmail) {
      await sendEmail(env, adminEmail, subject, html, orderNum);
      console.log(`[Mailer] Dispatched store order alert to admin ${adminEmail} for #${orderNum}.`);
    }

    // Notify any vendor emails attached to the ordered items.
    const vendorEmails = new Set<string>();
    if (order.items && Array.isArray(order.items)) {
      order.items.forEach((item: any) => {
        const vEmail = item.product?.vendorEmail || item.vendorEmail;
        if (vEmail && sanitizeEmail(vEmail)) vendorEmails.add(sanitizeEmail(vEmail));
      });
    }
    for (const vEmail of vendorEmails) {
      if (vEmail !== adminEmail) {
        await sendEmail(env, vEmail, `Listing Order Alert - Meris E-Shop (#${orderNum})`, html, orderNum);
        console.log(`[Mailer] Dispatched listing order alert to vendor ${vEmail} for #${orderNum}.`);
      }
    }
  } catch (err) {
    console.error('[Mailer] Exception in sendAdminVendorNotificationEmail:', err);
  }
}

/* ---------------------------------------------------------------------------
 * 4. Payment approved / rejected notifications (UPI flows)
 * ------------------------------------------------------------------------- */

export async function sendPaymentEmail(env: Env, order: any, type: 'approved' | 'rejected', reason?: string): Promise<EmailLogRecord | null> {
  try {
    const recipientEmail = sanitizeEmail(order.customerInfo?.email || 'guest@example.com');
    const customerName = sanitizeString(order.customerInfo?.name || 'Valued Customer', 100);
    const isApproved = type === 'approved';
    const subject = isApproved
      ? `Meris E-Shop: Payment Approved - Order #${order.orderNumber}`
      : `Meris E-Shop: Payment Verification Failed - Order #${order.orderNumber}`;

    const html = emailShell(subject, `
    ${brandHeader(isApproved ? '#10b981' : '#ef4444')}
    <div style="padding: 32px 24px 20px 24px;">
      <h2 style="font-size: 18px; color: #0f172a; margin-top: 0; margin-bottom: 12px; font-weight: 600;">Dear ${escapeHtml(customerName)},</h2>
      ${isApproved ? `
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0;">
          We are pleased to inform you that your UPI payment for order <strong>#${escapeHtml(order.orderNumber)}</strong> has been successfully verified!
        </p>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 12px 0 0 0;">
          Your order has been moved to <strong>Processing</strong> status. Our master artisans have begun handcrafting your items. You will receive another notification once your package is dispatched.
        </p>` : `
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0;">
          We regret to inform you that we could not verify your UPI payment for order <strong>#${escapeHtml(order.orderNumber)}</strong>.
        </p>
        <div style="background-color: #fef2f2; border-radius: 12px; padding: 16px; margin: 16px 0; border: 1px solid #fee2e2;">
          <p style="font-size: 13px; color: #991b1b; margin: 0; font-weight: bold;">Rejection Reason:</p>
          <p style="font-size: 13px; color: #7f1d1d; margin: 4px 0 0 0; font-style: italic;">
            "${escapeHtml(reason || 'The transaction reference number or screenshot did not match our accounts ledger.')}"
          </p>
        </div>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 12px 0 0 0;">
          Please log into your account dashboard, check your transaction credentials, and resubmit the correct UPI reference number or payment receipt screenshot to resume processing of your artisanal package.
        </p>`}
    </div>
    <div style="padding: 0 24px 24px 24px;">
      <div style="background-color: #f1f5f9; border-radius: 14px; padding: 18px; border: 1px dashed #cbd5e1;">
        <table style="width: 100%; border-collapse: collapse; font-size: 12px; font-family: monospace;">
          <tr>
            <td style="color: #64748b; padding-bottom: 6px; font-weight: bold;">ORDER NUMBER:</td>
            <td style="color: #0f172a; text-align: right; padding-bottom: 6px; font-weight: bold; font-size: 13px;">${escapeHtml(order.orderNumber)}</td>
          </tr>
          <tr>
            <td style="color: #64748b; padding-bottom: 6px; font-weight: bold;">TOTAL VALUE:</td>
            <td style="color: #0f172a; text-align: right; padding-bottom: 6px; font-weight: bold;">₹${Number(order.total || 0)}</td>
          </tr>
          <tr>
            <td style="color: #64748b; padding-bottom: 6px; font-weight: bold;">PAYMENT STATUS:</td>
            <td style="color: ${isApproved ? '#10b981' : '#ef4444'}; text-align: right; padding-bottom: 6px; font-weight: bold;">${escapeHtml((order.paymentStatus || '').toUpperCase())}</td>
          </tr>
          <tr>
            <td style="color: #64748b; font-weight: bold;">CURRENT ORDER STATUS:</td>
            <td style="color: #0f172a; text-align: right; font-weight: bold;">${escapeHtml((order.status || '').toUpperCase())}</td>
          </tr>
        </table>
      </div>
    </div>
    <div style="background-color: #f8fafc; border-top: 1px solid #f1f5f9; padding: 24px; text-align: center;">
      <p style="font-size: 12px; color: #64748b; margin: 0 0 8px 0; line-height: 1.5;">
        You can track your order status live in your Meris Account Dashboard at any time.
      </p>
      ${brandFooter()}
    </div>`);

    await sendEmail(env, recipientEmail, subject, html, order.orderNumber);
    return {
      id: `email_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      recipient: recipientEmail,
      subject,
      bodyHtml: html,
      sentAt: new Date().toLocaleString(),
      orderNumber: order.orderNumber,
      status: 'Delivered',
      dateText: new Date().toLocaleString(),
    };
  } catch (err) {
    console.error('[Mailer] Exception in sendPaymentEmail:', err);
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * 5. Welcome email (customer registration)
 * ------------------------------------------------------------------------- */

export async function sendWelcomeEmail(env: Env, email: string, name: string): Promise<void> {
  const subject = 'Welcome to MERIS E-SHOP - Happy Shopping!';
  const appUrl = (env.APP_URL || 'https://meris-eshop.workers.dev').replace(/\/$/, '');
  const html = emailShell(subject, `
    ${brandHeader()}
    <div style="padding: 32px 24px;">
      <h2 style="font-size: 18px; color: #0f172a; margin-top: 0;">Thanks for choosing us, ${escapeHtml(name)}!</h2>
      <p style="font-size: 14px; line-height: 1.6; color: #475569;">
        We are absolutely thrilled to welcome you to the MERIS family! Your account has been securely created.
      </p>
      <p style="font-size: 14px; line-height: 1.6; color: #475569; margin-top: 12px;">
        Explore our curated collection of developmental craft toys, customized stencils, and premium handcrafted gifts. We hope you enjoy browsing and shopping our unique heritage crafts.
      </p>
      <div style="text-align: center; margin-top: 24px;">
        <a href="${appUrl}" style="background-color: #f59e0b; color: #0f172a; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 13px; display: inline-block;">Happy Shopping &rarr;</a>
      </div>
    </div>
    ${brandFooter()}`);
  await sendEmail(env, email, subject, html, 'REGISTRATION');
}

/* ---------------------------------------------------------------------------
 * 6. Admin test email
 * ------------------------------------------------------------------------- */

export async function sendTestEmail(env: Env, targetEmail: string): Promise<boolean> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
      <h2 style="color: #0f172a; margin-top: 0;">Live Email Dispatch Successful!</h2>
      <p style="color: #475569;">Your Meris E-Shop Cloudflare Worker successfully dispatched this test email to <strong>${escapeHtml(targetEmail)}</strong> via the Resend mail service.</p>
      <p style="color: #64748b; font-size: 12px; margin-bottom: 0;">Dispatched at ${new Date().toLocaleString()}</p>
    </div>
  `;
  return sendEmail(env, targetEmail, 'Meris E-Shop: Live Email Dispatch Test', html, 'ADMIN_TEST');
}
