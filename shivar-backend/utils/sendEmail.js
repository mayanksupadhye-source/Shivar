const nodemailer = require('nodemailer');

// Reuse one transporter across the app instead of creating a new one per email
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

async function sendOtpEmail(toEmail, otpCode, name = '') {
  const mailOptions = {
    from: `"Nexora" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: `Your Nexora verification code: ${otpCode}`,
    html: `
      <div style="font-family:sans-serif;max-width:420px;margin:auto;padding:24px;border:1px solid #eee;border-radius:12px;">
        <h2 style="color:#2f5d1f;">Nexora</h2>
        <p>Hi ${name || 'there'},</p>
        <p>Your verification code is:</p>
        <div style="font-size:32px;font-weight:700;letter-spacing:6px;color:#2f5d1f;margin:16px 0;">${otpCode}</div>
        <p style="color:#777;font-size:13px;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6-digit code
}

module.exports = { sendOtpEmail, generateOtp };
