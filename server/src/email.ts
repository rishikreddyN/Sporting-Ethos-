import nodemailer from 'nodemailer';
import QRCode from 'qrcode';

let transporter: nodemailer.Transporter | null = null;
let lastSentQrUrl: string = '';
let lastSentQrToken: string = '';

export async function sendQrEmail(
  patientEmail: string, 
  patientName: string, 
  expertName: string, 
  scheduledTime: string, 
  token: string,
  appointmentId: string
) {
  const clientBase = process.env.CLIENT_URL || 'https://sporting-ethos.vercel.app';
  const checkinUrl = `${clientBase}/patient?token=${token}&patientId=${appointmentId}&name=${encodeURIComponent(patientName)}&time=${encodeURIComponent(scheduledTime)}`;
  
  // Generate QR Code PNG buffer & Base64
  const qrBuffer = await QRCode.toBuffer(checkinUrl, { width: 250, margin: 2 });
  const qrBase64 = qrBuffer.toString('base64');

  // 1. OPTION 1: Resend HTTP API (Bypasses all cloud SMTP port blocks)
  if (process.env.RESEND_API_KEY) {
    try {
      console.log('[EMAIL] Sending via Resend HTTPS API to:', patientEmail);
      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Sporting Ethos <onboarding@resend.dev>',
          to: [patientEmail],
          subject: 'Your check-in QR code — Sporting Ethos appointment confirmed',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff; color: #1e293b;">
              <h2 style="color: #0f172a; margin-top: 0;">Appointment Confirmed</h2>
              <p>Hi <strong>${patientName}</strong>,</p>
              <p>Your appointment with <strong>${expertName}</strong> is confirmed for <strong>${new Date(scheduledTime).toLocaleString()}</strong>.</p>
              <p>Please show this QR code at reception when you arrive for instant check-in:</p>
              <div style="text-align: center; margin: 25px 0;">
                <img src="data:image/png;base64,${qrBase64}" style="width: 200px; height: 200px; display: block; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 6px; padding: 5px;" alt="Appointment QR Code" />
              </div>
              <p style="font-size: 13px; color: #64748b;">Appointment ID: <code>${appointmentId}</code></p>
              <p style="margin-top: 25px;">See you soon,<br/><strong>Sporting Ethos High Performance Centre</strong></p>
            </div>
          `
        })
      });

      if (resendRes.ok) {
        const data = await resendRes.json();
        console.log('[EMAIL SENT RESEND SUCCESS]', data);
        lastSentQrUrl = checkinUrl;
        lastSentQrToken = token;
        return { testUrl: checkinUrl, token };
      } else {
        const errText = await resendRes.text();
        console.error('[EMAIL RESEND FAILED]:', errText);
      }
    } catch (e) {
      console.error('[EMAIL RESEND ERROR]:', e);
    }
  }

  // 2. OPTION 2: Standard SMTP (Gmail / Custom)
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    try {
      console.log(`[EMAIL] Attempting SMTP via ${host}:${port}...`);
      const smtpTransporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
        tls: { rejectUnauthorized: false },
        connectionTimeout: 10000 // 10 second timeout
      });

      const mailSender = `"Sporting Ethos Support" <${user}>`;
      const info = await smtpTransporter.sendMail({
        from: mailSender,
        to: patientEmail,
        subject: 'Your check-in QR code — Sporting Ethos appointment confirmed',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <h2>Appointment Confirmed</h2>
            <p>Hi <strong>${patientName}</strong>,</p>
            <p>Your appointment with <strong>${expertName}</strong> is confirmed for <strong>${new Date(scheduledTime).toLocaleString()}</strong>.</p>
            <div style="text-align: center; margin: 25px 0;">
              <img src="cid:qrcode" style="width: 200px; height: 200px; display: block; margin: 0 auto;" alt="QR Code" />
            </div>
            <p style="font-size: 13px; color: #64748b;">Appointment ID: <code>${appointmentId}</code></p>
          </div>
        `,
        attachments: [{ filename: 'checkin-qr.png', content: qrBuffer, cid: 'qrcode' }]
      });

      console.log(`[EMAIL SENT SMTP SUCCESS] MessageID: ${info.messageId}`);
      lastSentQrUrl = checkinUrl;
      lastSentQrToken = token;
      return { testUrl: checkinUrl, token };
    } catch (smtpErr) {
      console.error('[EMAIL SMTP FAILED]:', smtpErr);
    }
  }

  // 3. OPTION 3: Fallback Ethereal Test Inbox (Generates viewable email preview URL)
  console.log('[EMAIL] Generating Ethereal test inbox link...');
  try {
    const testAccount = await nodemailer.createTestAccount();
    const fallbackTransporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass }
    });

    const info = await fallbackTransporter.sendMail({
      from: '"Sporting Ethos Support" <reception@sportingethos.com>',
      to: patientEmail,
      subject: 'Your check-in QR code — Sporting Ethos appointment confirmed',
      html: `<p>Hi ${patientName}, your appointment with ${expertName} is confirmed.</p><div style="text-align:center"><img src="cid:qrcode"/></div>`,
      attachments: [{ filename: 'checkin-qr.png', content: qrBuffer, cid: 'qrcode' }]
    });

    const testUrl = nodemailer.getTestMessageUrl(info) || checkinUrl;
    console.log(`[ETHEREAL TEST INBOX CREATED]: ${testUrl}`);
    lastSentQrUrl = testUrl;
    lastSentQrToken = token;
    return { testUrl, token };
  } catch (err) {
    console.error('[EMAIL ETHEREAL ERROR]:', err);
    lastSentQrUrl = checkinUrl;
    lastSentQrToken = token;
    return { testUrl: checkinUrl, token };
  }
}

export function getLastSentQr() {
  return {
    url: lastSentQrUrl,
    token: lastSentQrToken
  };
}
