const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env manually to get the JWT_SECRET
const envPath = path.join(__dirname, '.env');
let jwtSecret = 'default_secret';
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const lines = envContent.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*JWT_SECRET\s*=\s*(.*)$/);
    if (match) {
      jwtSecret = match[1].trim().replace(/^["']|["']$/g, '');
      break;
    }
  }
}

// Function to generate JWT manually using Node's crypto
function generateToken(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  
  const base64UrlEncode = (obj) => {
    return Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  };

  const encodedHeader = base64UrlEncode(header);
  const encodedPayload = base64UrlEncode(payload);

  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

// Generate token for a default user
const payload = {
  sub: 'a3d8c11e-28b9-4786-8a71-dfc6fcf4a29a', // Valid UUID
  username: 'test_user',
  email: 'test@example.com'
};

const token = generateToken(payload, jwtSecret);
console.log('\n🔑 Generated Test JWT Token:\n');
console.log(token);
console.log('\n👉 Copy this token, go to Swagger UI (http://localhost:3000/api/docs), click the "Authorize" button, paste it, and try your requests again!\n');
