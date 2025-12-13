// controllers/admin/customerController.js

const User = require('../../models/userSchema');
const mongoose = require('mongoose');





/** Utility: short customer id from ObjectId */
function shortCustomerId(objectId) {
  try {
    const hex = objectId.toString();
    return `CUS-${hex.slice(-6).toUpperCase()}`;
  } catch (e) {
    return `CUS-${Date.now().toString().slice(-6)}`;
  }
}

function extractNameFromEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const atIndex = email.indexOf('@');
  const local = atIndex === -1 ? email : email.slice(0, atIndex);

  // remove plus tags (foo+tag -> foo)
  const withoutPlus = local.split('+')[0];

  // replace separators with spaces
  const replaced = withoutPlus.replace(/[._\-]+/g, ' ');

  // trim extra spaces
  const trimmed = replaced.trim();

  // collapse multiple spaces
  const collapsed = trimmed.replace(/\s+/g, ' ');

  if (!collapsed) return '';

  // capitalize words: "john doe" -> "John Doe"
  const words = collapsed.split(' ').map(w => {
    const s = w.toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  });

  return words.join(' ');
}

// defensive parsePaging + updated customerInfo
function parsePaging(req) {
  // guard: ensure req object exists
  if (!req) {
    // fallback defaults
    return { page: 1, limit: 10, q: '' };
  }

  const qFromQuery = req.query && (typeof req.query.q !== 'undefined') ? req.query.q : undefined;
  const pageFromQuery = req.query && (typeof req.query.page !== 'undefined') ? req.query.page : undefined;
  const limitFromQuery = req.query && (typeof req.query.limit !== 'undefined') ? req.query.limit : undefined;

  const qFromBody = req.body && (typeof req.body.q !== 'undefined') ? req.body.q : undefined;
  const pageFromBody = req.body && (typeof req.body.page !== 'undefined') ? req.body.page : undefined;
  const limitFromBody = req.body && (typeof req.body.limit !== 'undefined') ? req.body.limit : undefined;

  const rawPage = pageFromQuery ?? pageFromBody ?? '1';
  const rawLimit = limitFromQuery ?? limitFromBody ?? '10';
  const rawQ = qFromQuery ?? qFromBody ?? '';

  const page = Math.max(parseInt(String(rawPage || '1'), 10) || 1, 1);
  const limit = Math.max(parseInt(String(rawLimit || '10'), 10) || 10, 1);
  const q = String(rawQ || '').trim();

  return { page, limit, q };
}

const customerInfo = async (req, res) => {
  try {
    const { page, limit, q } = parsePaging(req);
    const skip = (page - 1) * limit;

    /* -------------------------------------------------
       BASE FILTER (non-admin + NOT soft-deleted)
    -------------------------------------------------- */
    const baseFilter = {
      isAdmin: false,
      isDeleted: { $ne: true }
    };

    /* -------------------------------------------------
       SEARCH LOGIC
       Supports:
       - name
       - email
       - customerId (CUS-XXXXXX)
       - status (active / blocked)
       - orders (numeric)
    -------------------------------------------------- */
    if (q) {
      const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(safeQ, 'i');

      const orConditions = [
        { name: regex },
        { email: regex }
      ];

      // status search
      if (q.toLowerCase() === 'blocked') {
        orConditions.push({ isBlocked: true });
      } else if (q.toLowerCase() === 'active') {
        orConditions.push({ isBlocked: false });
      }

      // numeric search → order count
      const numericQ = Number(q);
      if (!isNaN(numericQ)) {
        orConditions.push({
          $expr: {
            $eq: [
              { $size: { $ifNull: ['$orderHistory', []] } },
              numericQ
            ]
          }
        });
      }

      baseFilter.$or = orConditions;
    }

    /* -------------------------------------------------
       COUNT (for pagination)
    -------------------------------------------------- */
    const total = await User.countDocuments(baseFilter);

    /* -------------------------------------------------
       FETCH USERS
    -------------------------------------------------- */
    const users = await User.find(baseFilter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    /* -------------------------------------------------
       MAP → CUSTOMER VIEW MODEL
    -------------------------------------------------- */
    const customers = users.map(user => {
      const orderCount = Array.isArray(user.orderHistory)
        ? user.orderHistory.length
        : Array.isArray(user.orderdetails)
          ? user.orderdetails.length
          : 0;

      return {
        _id: user._id,
        name: user.name && user.name.trim()
          ? user.name
          : (extractNameFromEmail(user.email) || user.email || '—'),
        email: user.email,
        customerId: shortCustomerId(user._id),
        orderCount,
        wallet: typeof user.wallet === 'number' ? user.wallet : 0,
        isBlocked: !!user.isBlocked,
        createdAt: user.createdAt
      };
    });

    const totalPages = Math.max(Math.ceil(total / limit), 1);

    return res.render('customers', {
      adminUser: req.session.admin || null,
      customers,
      pagination: {
        total,
        totalPages,
        page,
        limit,
        q
      }
    });

  } catch (error) {
    console.error('[ADMIN] customerInfo error:', error);
    return res.status(500).render('error-page', {
      message: 'Unable to load customers'
    });
  }
};




/**
 * POST /admin/customer/toggle/:id
 * Toggle block/unblock status for a given user.
 * - If request is AJAX (Accept: application/json or fetch), returns JSON.
 * - If not, falls back to redirect to /admin/customer (non-JS forms).
 */
const toggleBlockUser = async (req, res) => {
  try {
    const userId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      const msg = 'Invalid user id';
      console.warn('[ADMIN] toggleBlockUser invalid id:', userId);
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ success: false, message: msg });
      }
      return res.redirect('/admin/customer');
    }

    const user = await User.findById(userId);
    if (!user) {
      const msg = 'User not found';
      console.warn('[ADMIN] toggleBlockUser user not found:', userId);
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(404).json({ success: false, message: msg });
      }
      return res.redirect('/admin/customer');
    }

    user.isBlocked = !user.isBlocked;
    await user.save();

    const message = user.isBlocked ? 'User blocked' : 'User unblocked';
    console.log(`[ADMIN] toggleBlockUser: user ${userId} isBlocked -> ${user.isBlocked}`);

    // respond JSON for AJAX clients
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json({ success: true, message, isBlocked: user.isBlocked });
    }

    // non-AJAX fallback
    return res.redirect('/admin/customer');
  } catch (error) {
    console.error('[ADMIN] toggleBlockUser error:', error);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ success: false, message: 'Server error' });
    }
    return res.redirect('/admin/errorPage');
  }
};
const deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid customer ID'
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // HARD DELETE
    // await User.deleteOne({ _id: id });

    user.isDeleted = true;
    await user.save();

    // If you prefer SOFT DELETE instead, tell me
    // user.isDeleted = true;
    // await user.save();

    return res.json({
      success: true,
      message: 'Customer deleted successfully'
    });

  } catch (err) {
    console.error('[ADMIN] deleteCustomer error:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

module.exports = {
  customerInfo,
  toggleBlockUser,
  deleteCustomer
};

