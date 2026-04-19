function normalizeStoredRegistrationStatus(value) {
  const status = String(value || '').trim().toLowerCase();

  if (status === 'verified' || status === 'pending' || status === 'rejected') {
    return status;
  }

  return '';
}

function resolveRegistrationVerificationStatus(user) {
  if (!user) {
    return 'pending';
  }

  if (user.role === 'admin') {
    return 'verified';
  }

  const storedStatus = normalizeStoredRegistrationStatus(user.registrationVerificationStatus);

  if (storedStatus) {
    return storedStatus;
  }

  return user.registrationPaidAt ? 'verified' : 'pending';
}

function isRegistrationApproved(user) {
  return resolveRegistrationVerificationStatus(user) === 'verified';
}

module.exports = {
  isRegistrationApproved,
  normalizeStoredRegistrationStatus,
  resolveRegistrationVerificationStatus,
};
