// controllers/admin/customerController.js

const User = require('../../models/userSchema'); // adjust path if needed
const mongoose = require('mongoose');

/**
 * Generate a short customer id from ObjectId
 * Example: CUS-5F3A1B (last 6 hex chars uppercase)
 */


function shortCustomerId(objectId) {
  try {
    const hex = objectId.toString();
    return `CUS-${hex.slice(-6).toUpperCase()}`;
  } catch (e) {
    return `CUS-${Date.now().toString().slice(-6)}`;
  }
}

/**
 * GET /admin/customer
 * Renders customer listing page for admin
 */
// controllers/admin/customerController.js
// (replace only the customerInfo function)

const customerInfo = async (req, res) => {
  console.log('[ADMIN] customerInfo: start');
  try {
    // fetch non-admin users only
    const users = await User.find({ isAdmin: false }).lean();
    console.log('[ADMIN] customerInfo: users fetched:', Array.isArray(users) ? users.length : users);

    // Map users to view model
    const customers = users.map(user => ({
      _id: user._id,
      name: user.name || user.email || '—',
      email: user.email,
      customerId: shortCustomerId(user._id),
      orderCount: Array.isArray(user.orderHistory) ? user.orderHistory.length : (user.orderdetails ? user.orderdetails.length : 0),
      wallet: typeof user.wallet === 'number' ? user.wallet : 0,
      isBlocked: !!user.isBlocked,
      createdAt: user.createdAt
    }));

    console.log('[ADMIN] customerInfo: rendering customers view with', customers.length, 'customers');
    return res.render('customers', { adminUser: req.session.admin || null, customers });
  } catch (error) {
    // Log the full error so we can see the root cause
    console.error('[ADMIN] customerInfo error:', error && error.stack ? error.stack : error);
    // Render admin error view (ensure views/admin/error-page.ejs exists)
    return res.status(500).render('error-page', { message: 'Unable to load customers' });
  }
};



 

/**
 * POST /admin/customer/toggle/:id
 * Toggle block/unblock status for a given user
 */
const toggleBlockUser = async (req, res) => {
  try {
    const userId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.warn('[ADMIN] toggleBlockUser invalid id:', userId);
      return res.redirect('/admin/customer');
    }

    const user = await User.findById(userId);
    if (!user) {
      console.warn('[ADMIN] toggleBlockUser user not found:', userId);
      return res.redirect('/admin/customer');
    }

    user.isBlocked = !user.isBlocked;
    await user.save();

    console.log(`[ADMIN] toggleBlockUser: user ${userId} isBlocked -> ${user.isBlocked}`);
    return res.redirect('/admin/customer');
  } catch (error) {
    console.error('[ADMIN] toggleBlockUser error:', error);
    return res.redirect('/admin/errorPage');
  }
};

module.exports = {
  customerInfo,
  toggleBlockUser
};
