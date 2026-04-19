const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { isRegistrationApproved, resolveRegistrationVerificationStatus } = require('../services/registration-state');

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
  return isRegistrationApproved(user);
}

function requireRegistrationVerified(req, res, next) {
  if (!isRegistrationVerified(req.user)) {
    return res.status(403).json({
      message: 'Your account is in review. Access will unlock shortly.',
      registrationVerificationStatus: resolveRegistrationVerificationStatus(req.user),
    });
  }

  return next();
}

module.exports = {
  requireAuth,
  requireAdmin,
  requireRegistrationVerified,
};
