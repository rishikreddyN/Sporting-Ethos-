import nodemailer from 'nodemailer';
import QRCode from 'qrcode';

let transporter: nodemailer.Transporter | null = null;
let lastSentQrUrl: string = '';
let lastSentQrToken: string = '';

async function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    console.log(`Using custom SMTP Transporter: ${host}:${port} for User: ${user}`);
    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      tls: { rejectUnauthorized: false }
    });
  } else if (process.env.RESEND_API_KEY) {
    console.log('Using Resend SMTP Transporter (smtp.resend.com)');
    transporter = nodemailer.createTransport({
      host: 'smtp.resend.com',
      port: 465,
      secure: true,
      auth: {
        user: 'resend',
        pass: process.env.RESEND_API_KEY
      }
    });
  } else {
    console.log('No SMTP config found. Initializing Ethereal dynamic test account...');
    try {
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass
        }
      });
      console.log('Ethereal SMTP test account created. Username:', testAccount.user);
    } catch (err) {
      console.error('Failed to create Ethereal SMTP transporter, falling back to JSON console logger:', err);
      transporter = nodemailer.createTransport({
        jsonTransport: true
      });
    }
  }
  return transporter;
}

export async function sendQrEmail(
  patientEmail: string, 
  patientName: string, 
  expertName: string, 
  scheduledTime: string, 
  token: string,
  appointmentId: string
) {
  const clientBase = process.env.CLIENT_URL || 'https://sporting-ethos.vercel.app';
  // Construct rich QR payload pointing to live frontend or local client
  const checkinUrl = `${clientBase}/patient?token=${token}&patientId=${appointmentId}&name=${encodeURIComponent(patientName)}&time=${encodeURIComponent(scheduledTime)}`;
  
  try {
    const transport = await getTransporter();
    
    // Generate QR Code PNG buffer
    const qrBuffer = await QRCode.toBuffer(checkinUrl, {
      width: 250,
      margin: 2
    });

    const user = process.env.SMTP_USER;
    // Gmail requires sender address to match authenticated user
    const mailSender = user 
      ? `"Sporting Ethos Support" <${user}>`
      : (process.env.SMTP_FROM || '"Sporting Ethos Support" <reception@sportingethos.com>');
    
    const mailOptions = {
      from: mailSender,
      to: patientEmail,
      subject: 'Your check-in QR code — Sporting Ethos appointment confirmed',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff; color: #1e293b;">
          <h2 style="color: #0f172a; margin-top: 0;">Appointment Confirmed</h2>
          <p>Hi <strong>${patientName}</strong>,</p>
          
          <p>Your appointment with <strong>${expertName}</strong> is confirmed for <strong>${new Date(scheduledTime).toLocaleString()}</strong>.</p>
          
          <p>Please show this QR code at reception when you arrive for instant check-in:</p>
          
          <div style="text-align: center; margin: 25px 0;">
            <img src="cid:qrcode" style="width: 200px; height: 200px; display: block; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 6px; padding: 5px;" alt="Appointment QR Code" />
          </div>
          
          <p style="font-size: 13px; color: #64748b;">Appointment ID: <code>${appointmentId}</code></p>
          
          <p style="margin-top: 25px;">See you soon,<br/><strong>Sporting Ethos High Performance Centre</strong></p>
        </div>
      `,
      attachments: [
        {
          filename: 'checkin-qr.png',
          content: qrBuffer,
          cid: 'qrcode'
        }
      ]
    };

    const info = await transport.sendMail(mailOptions);
    const testUrl = nodemailer.getTestMessageUrl(info);
    console.log(`[EMAIL SENT SUCCESS] To: ${patientEmail}. MessageID: ${info.messageId}`);
    
    if (testUrl) {
      console.log(`[Ethereal Preview Link]: ${testUrl}`);
      lastSentQrUrl = testUrl;
    } else {
      lastSentQrUrl = checkinUrl;
    }
    lastSentQrToken = token;
    
    return { testUrl, token };
  } catch (error) {
    console.error('Failed to send QR email via primary transporter:', error);
    
    // Fallback attempt: create Ethereal message so appointment creation never breaks
    try {
      console.log('Attempting fallback Ethereal email dispatch...');
      const testAccount = await nodemailer.createTestAccount();
      const fallbackTransporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: testAccount.user, pass: testAccount.pass }
      });

      const qrBuffer = await QRCode.toBuffer(checkinUrl, { width: 250, margin: 2 });
      const info = await fallbackTransporter.sendMail({
        from: '"Sporting Ethos Support" <reception@sportingethos.com>',
        to: patientEmail,
        subject: 'Your check-in QR code — Sporting Ethos appointment confirmed',
        html: `<p>Hi ${patientName}, your appointment with ${expertName} is confirmed.</p><div style="text-align:center"><img src="cid:qrcode"/></div>`,
        attachments: [{ filename: 'checkin-qr.png', content: qrBuffer, cid: 'qrcode' }]
      });
      const testUrl = nodemailer.getTestMessageUrl(info) || checkinUrl;
      lastSentQrUrl = testUrl;
      lastSentQrToken = token;
      console.log(`[FALLBACK ETHEREAL SENT SUCCESS] Preview: ${testUrl}`);
      return { testUrl, token };
    } catch (fallbackError) {
      console.error('Fallback email dispatch also failed:', fallbackError);
      lastSentQrUrl = checkinUrl;
      lastSentQrToken = token;
      return { testUrl: checkinUrl, token };
    }
  }
}

export function getLastSentQr() {
  return {
    url: lastSentQrUrl,
    token: lastSentQrToken
  };
}
