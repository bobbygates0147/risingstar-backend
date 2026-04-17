const jwt = require('jsonwebtoken');
const User = require('../models/User');

function getJwtSecret() {
  return process.env.JWT_SECRET || 'risingstar-dev-secret-change-me';
}

function verifyToken(token) {
  return jwt.verify(token, getJwtSecret());
}

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const payload = verifyToken(token);
    const user = await User.findById(payload.sub);

    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Invalid session' });
    }

    req.user = user;
    req.auth = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }

  return next();
}

function isRegistrationVerified(user) {
  if (!user) {
    return false;
  }

  if (user.role === 'admin') {
    return true;
  }

  const status = String(user.registrationVerificationStatus || '').trim().toLowerCase();
  return status === 'verified' || Boolean(user.registrationPaidAt);
}

function requireRegistrationVerified(req, res, next) {
  if (!isRegistrationVerified(req.user)) {
    return res.status(403).json({
      message: 'Registration deposit is pending admin confirmation.',
      registrationVerificationStatus: req.user?.registrationVerificationStatus || 'pending',
    });
  }

  return next();
}

module.exports = {
  requireAuth,
  requireAdmin,
  requireRegistrationVerified,
};
