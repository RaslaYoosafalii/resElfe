// controllers/admin/categoryController.js
const { Category, SubCategory } = require('../../models/categorySchema');
const { Product } = require('../../models/productSchema');
const mongoose = require('mongoose');



function parsePaging(req) {
  const page = Math.max(parseInt(req.query.page || '1', 10), 1);
  const limit = Math.max(parseInt(req.query.limit || '10', 10), 1);
  const q = (req.query.q || '').toString().trim();
  return { page, limit, q };
}
/**
 * GET /admin/category
 * Show category list, subcategories and simple actions
 */
const listCategories = async (req, res) => {
  try {
    const { page, limit, q } = parsePaging(req);

    // build filter (search by name OR description; case-insensitive)
    const filter = {};
    if (q) {
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); // escape regex metachars
      filter.$or = [{ name: re }, { description: re }];
    }

    // total count for pagination
    const total = await Category.countDocuments(filter);

    // fetch categories for this page sorted desc by createdAt
    const categories = await Category.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // fetch all subcategories for categories on this page
    const categoryIds = categories.map(c => c._id);
    const subs = await SubCategory.find({ Category: { $in: categoryIds } }).lean();
    const subMap = subs.reduce((m, s) => {
      const key = String(s.Category);
      if (!m[key]) m[key] = [];
      m[key].push(s);
      return m;
    }, {});

    // compute product counts for each category (only for the page)
    // use countDocuments for each category — okay for modest pages; if you expect huge scale use aggregation
    const categoriesWithMeta = await Promise.all(categories.map(async (cat) => {
      const productCount = await Product.countDocuments({ categoryId: cat._id });
      return {
        ...cat,
        productCount,
        subcategories: subMap[String(cat._id)] || []
      };
    }));

    const totalPages = Math.max(Math.ceil(total / limit), 1);

    return res.render('categories', {
      categories: categoriesWithMeta,
      message: null,
      // pagination metadata for UI
      pagination: {
        total, totalPages, page, limit, q
      }
    });
  } catch (err) {
    console.error('[ADMIN] listCategories error:', err);
    return res.status(500).render('error-page', { message: 'Failed to load categories' });
  }
};

const getCategoryData = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid id' });

    const cat = await Category.findById(id).lean();
    if (!cat) return res.status(404).json({ success: false, message: 'Category not found' });

    const subcategories = await SubCategory.find({ Category: id }).lean();

    return res.json({ success: true, category: cat, subcategories });
  } catch (err) {
    console.error('[ADMIN] getCategoryData error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};



const editCategory = async (req, res) => {
  try {
    const id = req.params.id;
    const { name, description, isListed } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    if (!name || !description) return res.status(400).json({ success: false, message: 'Name and description required' });

    const cat = await Category.findById(id);
    if (!cat) return res.status(404).json({ success: false, message: 'Category not found' });

    // check unique name (if changed)
    if (cat.name !== name.trim()) {
      const exists = await Category.findOne({ name: name.trim(), _id: { $ne: id } });
      if (exists) return res.status(400).json({ success: false, message: 'Another category with this name exists' });
    }

    cat.name = name.trim();
    cat.description = description.trim();
    cat.isListed = (isListed === 'true' || isListed === true || isListed === '1' || isListed === 1);

    await cat.save();

    console.log('[ADMIN] editCategory:', id);
    return res.json({ success: true, message: 'Category updated', category: cat });
  } catch (err) {
    console.error('[ADMIN] editCategory error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const editSubCategory = async (req, res) => {
  try {
    const id = req.params.id;
    const { fitName } = req.body;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    if (!fitName) return res.status(400).json({ success: false, message: 'Name required' });

    const sub = await SubCategory.findById(id);
    if (!sub) return res.status(404).json({ success: false, message: 'Subcategory not found' });

    // unique fitName check
    if (String(sub.fitName) !== String(fitName.trim())) {
      const exists = await SubCategory.findOne({ fitName: fitName.trim(), _id: { $ne: id } });
      if (exists) return res.status(400).json({ success: false, message: 'Another subcategory with this name already exists' });
    }

    sub.fitName = fitName.trim();
    await sub.save();

    console.log('[ADMIN] editSubCategory:', id);
    return res.json({ success: true, message: 'Subcategory updated', subcategory: sub });
  } catch (err) {
    console.error('[ADMIN] editSubCategory error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};


/**
 * POST /admin/category/create
 * Create a new category
 */
const createCategory = async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !description) {
      return res.render('admin/categories', { categories: [], message: 'Name and description are required' });
    }

    // create unique category
    const exists = await Category.findOne({ name: name.trim() });
    if (exists) {
      console.log('[ADMIN] createCategory failed: category exists -', name);
      return res.render('admin/categories', { categories: [], message: 'Category already exists' });
    }

    await Category.create({ name: name.trim(), description: description.trim(), isListed: true });
    console.log('[ADMIN] createCategory: created', name);
    return res.redirect('/admin/category');
  } catch (err) {
    console.error('[ADMIN] createCategory error:', err);
    return res.status(500).render('error-page', { message: 'Failed to create category' });
  }
};

/**
 * POST /admin/category/subcreate
 * Create a new subcategory for a category
 */
const createSubCategory = async (req, res) => {
  try {
    const { categoryId, fitName } = req.body;
    if (!categoryId || !fitName) {
      return res.redirect('/admin/category');
    }
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.redirect('/admin/category');
    }

    const exists = await SubCategory.findOne({ fitName: fitName.trim() });
    if (exists) {
      console.log('[ADMIN] createSubCategory failed: sub exists -', fitName);
      return res.redirect('/admin/category');
    }

    await SubCategory.create({ Category: categoryId, fitName: fitName.trim() });
    console.log('[ADMIN] createSubCategory: created', fitName);
    return res.redirect('/admin/category');
  } catch (err) {
    console.error('[ADMIN] createSubCategory error:', err);
    return res.status(500).render('error-page', { message: 'Failed to create subcategory' });
  }
};

/**
 * POST /admin/category/toggle/:id
 * Toggle category list/unlist (isListed)
 */
const toggleCategoryList = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.redirect('/admin/category');

    const cat = await Category.findById(id);
    if (!cat) return res.redirect('/admin/category');

    cat.isListed = !cat.isListed;
    await cat.save();
    console.log('[ADMIN] toggleCategoryList:', id, '->', cat.isListed);
    return res.redirect('/admin/category');
  } catch (err) {
    console.error('[ADMIN] toggleCategoryList error:', err);
    return res.status(500).render('error-page', { message: 'Failed to toggle category' });
  }
};

/**
 * POST /admin/category/offer/:id
 * Set or clear an offer for a category
 * body: { offerPrice, offerValidDate } - if empty, clears the offer
 */
// controllers/admin/categoryController.js (replace setCategoryOffer)
const setCategoryOffer = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.redirect('/admin/category');

    const { offerType, offerValue, offerValidDate } = req.body;
    const cat = await Category.findById(id);
    if (!cat) return res.redirect('/admin/category');

    // If offerValue is empty or falsy -> clear offer
    const valueTrim = (offerValue || '').toString().trim();
    if (!valueTrim) {
      cat.offerPrice = 0;
      cat.offerIsPercent = false;
      cat.offerValidDate = undefined;
      await cat.save();
      console.log('[ADMIN] setCategoryOffer: cleared offer for', id);
      return res.redirect('/admin/category');
    }

    // parse numeric input
    const numericValue = Number(valueTrim);
    if (Number.isNaN(numericValue) || numericValue < 0) {
      console.warn('[ADMIN] setCategoryOffer invalid value:', offerValue);
      // keep user on page with message (simple approach)
      return res.render('categories', { categories: [], message: 'Invalid offer value' });
    }

    // handle percentage vs fixed
    if (offerType === 'percent') {
      // validate percent range
      if (numericValue <= 0 || numericValue > 100) {
        return res.render('categories', { categories: [], message: 'Percentage must be between 1 and 100' });
      }
      cat.offerIsPercent = true;
      cat.offerPrice = numericValue; // e.g., 20 -> 20%
    } else {
      // fixed amount
      cat.offerIsPercent = false;
      cat.offerPrice = numericValue; // currency units
    }

    cat.offerValidDate = offerValidDate ? new Date(offerValidDate) : undefined;

    await cat.save();
    console.log('[ADMIN] setCategoryOffer:', id, 'value:', cat.offerPrice, 'isPercent:', cat.offerIsPercent, 'validUntil:', cat.offerValidDate);
    return res.redirect('/admin/category');
  } catch (err) {
    console.error('[ADMIN] setCategoryOffer error:', err);
    return res.status(500).render('error-page', { message: 'Failed to set offer' });
  }
};

// GET /admin/category/subdata/:id
const getSubCategoryData = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid id' });

    const sub = await SubCategory.findById(id).lean();
    if (!sub) return res.status(404).json({ success: false, message: 'Not found' });

    return res.json({ success: true, subcategory: sub });
  } catch (err) {
    console.error('[ADMIN] getSubCategoryData error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};


const deleteCategory = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid category id' });
    }

    // Prevent deletion if there are products under this category
    const productCount = await Product.countDocuments({ categoryId: id });
    if (productCount > 0) {
      return res.status(400).json({ success: false, message: 'Cannot delete category with products. Unlist products or move them first.' });
    }

    // Delete subcategories belonging to this category
    await SubCategory.deleteMany({ Category: id });

    // Delete the category
    await Category.findByIdAndDelete(id);

    console.log('[ADMIN] deleteCategory:', id);
    return res.json({ success: true, message: 'Category deleted' });
  } catch (err) {
    console.error('[ADMIN] deleteCategory error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /admin/category/subdelete/:id
 * Delete a subcategory if no products reference it.
 */
const deleteSubCategory = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid subcategory id' });
    }

    const sub = await SubCategory.findById(id);
    if (!sub) {
      return res.status(404).json({ success: false, message: 'Subcategory not found' });
    }

    // Prevent deletion if any product references this subcategory
    // Note: your product.subcategoryId is a String; adjust matching accordingly
    const productsUsing = await Product.countDocuments({ subcategoryId: String(id) });
    if (productsUsing > 0) {
      return res.status(400).json({ success: false, message: 'Cannot delete subcategory with products. Reassign or remove products first.' });
    }

    await SubCategory.findByIdAndDelete(id);

    console.log('[ADMIN] deleteSubCategory:', id);
    return res.json({ success: true, message: 'Subcategory deleted' });
  } catch (err) {
    console.error('[ADMIN] deleteSubCategory error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};


module.exports = {
  listCategories,
  createCategory,
  createSubCategory,
  toggleCategoryList,
  setCategoryOffer,
  deleteCategory,
  deleteSubCategory,
  getCategoryData,
  editCategory,
  editSubCategory,
  getSubCategoryData
};
