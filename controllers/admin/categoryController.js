// controllers/admin/categoryController.js
const { Category, SubCategory } = require('../../models/categorySchema');
const { Product } = require('../../models/productSchema');
const mongoose = require('mongoose');

/**
 * GET /admin/category
 * Show category list, subcategories and simple actions
 */
const listCategories = async (req, res) => {
  try {
    // fetch categories and their subcategories
    const categories = await Category.find().lean();
    // get subcategories grouped by category id
    const subs = await SubCategory.find().lean();
    const subMap = subs.reduce((m, s) => {
      const key = String(s.Category);
      if (!m[key]) m[key] = [];
      m[key].push(s);
      return m;
    }, {});

    // For each category compute product count (cheap approach)
    const categoriesWithMeta = await Promise.all(categories.map(async (cat) => {
      const productCount = await Product.countDocuments({ categoryId: cat._id });
      return {
        ...cat,
        productCount,
        subcategories: subMap[String(cat._id)] || []
      };
    }));

    return res.render('admin/categories', { categories: categoriesWithMeta, message: null });
  } catch (err) {
    console.error('[ADMIN] listCategories error:', err);
    return res.status(500).render('error-page', { message: 'Failed to load categories' });
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
const setCategoryOffer = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.redirect('/admin/category');

    const { offerPrice, offerValidDate } = req.body;
    const cat = await Category.findById(id);
    if (!cat) return res.redirect('/admin/category');

    if (!offerPrice) {
      // clear offer
      cat.offerPrice = undefined;
      cat.offerValidDate = undefined;
    } else {
      cat.offerPrice = offerPrice;
      cat.offerValidDate = offerValidDate ? new Date(offerValidDate) : undefined;
    }
    await cat.save();
    console.log('[ADMIN] setCategoryOffer:', id, cat.offerPrice, cat.offerValidDate);
    return res.redirect('/admin/category');
  } catch (err) {
    console.error('[ADMIN] setCategoryOffer error:', err);
    return res.status(500).render('error-page', { message: 'Failed to set offer' });
  }
};

module.exports = {
  listCategories,
  createCategory,
  createSubCategory,
  toggleCategoryList,
  setCategoryOffer
};
