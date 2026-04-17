const express = require('express');

const {
  getCountryCurrencyOptions,
  getCountryOptionByCode,
} = require('../data/country-currency');
const {
  convertFromUsd,
  getUsdRateTable,
} = require('../services/currency-service');

const router = express.Router();

router.get('/countries', (req, res) => {
  res.json({ countries: getCountryCurrencyOptions() });
});

router.get('/rates', async (req, res, next) => {
  try {
    res.json(await getUsdRateTable());
  } catch (error) {
    next(error);
  }
});

router.get('/convert', async (req, res, next) => {
  try {
    const country = getCountryOptionByCode(req.query.countryCode);
    const currency = String(req.query.currency || country.currency || 'USD').trim().toUpperCase();
    const conversion = await convertFromUsd(req.query.amountUsd, currency);

    res.json({
      ...conversion,
      country,
    });
  } catch (error) {
    if (error.message === 'Valid USD amount is required') {
      return res.status(400).json({ message: error.message });
    }

    return next(error);
  }
});

module.exports = router;
