const express = require('express');

const {
  createAuthResponse,
  getSignupPricingConfig,
  loginUser,
  registerUser,
  toPublicUser,
} = require('../services/auth-service');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/signup-config', (req, res) => {
  res.json(getSignupPricingConfig());
});

router.post('/signup', async (req, res, next) => {
  try {
    const user = await registerUser(req.body || {});
    res.status(201).json(createAuthResponse(user));
  } catch (error) {
    if (error.message === 'Email already registered') {
      return res.status(409).json({ message: error.message });
    }

    if (
      error.message === 'Name should be at least 2 characters' ||
      error.message === 'Valid email is required' ||
      error.message === 'Password should be at least 4 characters' ||
      error.message === 'Valid registration tier is required' ||
      error.message === 'Valid payment method is required' ||
      error.message === 'Payment reference should be at least 3 characters' ||
      error.message === 'Payment amount is required' ||
      error.message.startsWith('Payment amount must match ')
    ) {
      return res.status(400).json({ message: error.message });
    }

    return next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const user = await loginUser(req.body || {});
    res.json(createAuthResponse(user));
  } catch (error) {
    if (error.message === 'Invalid email or password') {
      return res.status(401).json({ message: error.message });
    }

    if (error.message === 'Email and password are required') {
      return res.status(400).json({ message: error.message });
    }

    return next(error);
  }
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

module.exports = router;
