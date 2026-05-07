function getJwtSecret() {
  const secret = String(process.env.JWT_SECRET || '').trim();

  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }

  return secret;
}

module.exports = {
  getJwtSecret
};