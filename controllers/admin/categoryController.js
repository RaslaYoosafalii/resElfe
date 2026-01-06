// controllers/admin/categoryController.js
import { Category, SubCategory } from '../../models/categorySchema.js';
import { Product } from '../../models/productSchema.js';
import mongoose from 'mongoose';

function parsePaging(req) {
  const page = Math.max(parseInt(req.query.page || '1', 10), 1);
  const limit = Math.max(parseInt(req.query.limit || '10', 10), 1);
  const q = (req.query.q || '').toString().trim();
  return { page, limit, q };
}

// Show category list, subcategories and simple actions
const listCategories = async (req, res) => {
  try {
    const { page, limit, q } = parsePaging(req);

    // build filter (search by name OR description; case-insensitive)
    const filter = {};
    if (q) {
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
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

    // calculate product counts for each category
    const categoriesWithMeta = await Promise.all(
      categories.map(async (cat) => {
        const productCount = await Product.countDocuments({ categoryId: cat._id });
        return {
          ...cat,
          productCount,
          subcategories: subMap[String(cat._id)] || []
        };
      })
    );

    const totalPages = Math.max(Math.ceil(total / limit), 1);

    return res.render('categories', {
      categories: categoriesWithMeta,
      message: null,
      pagination: {
        total,
        totalPages,
        page,
        limit,
        q
      }
    });
  } catch (err) {
    console.error('listCategories function error:', err);
    return res.status(500).render('error-page', { message: 'Failed to load categories' });
  }
};

const getCategoryData = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }

    const cat = await Category.findById(id).lean();
    if (!cat) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    const subcategories = await SubCategory.find({ Category: id }).lean();

    return res.json({ success: true, category: cat, subcategories });
  } catch (err) {
    console.error('getCategoryData function error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const editCategory = async (req, res) => {
  try {
    const id = req.params.id;
    const { name, description, isListed } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }
    if (!name || !description) {
      return res.status(400).json({ success: false, message: 'Name and description required' });
    }

    const cat = await Category.findById(id);
    if (!cat) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    // check unique name (if changed)
    if (cat.name !== name.trim()) {
      const exists = await Category.findOne({ name: name.trim(), _id: { $ne: id } });
      if (exists) {
        return res.status(400).json({
          success: false,
          message: 'Another category with this name exists'
        });
      }
    }

    cat.name = name.trim();
    cat.description = description.trim();
    cat.isListed =
      isListed === 'true' ||
      isListed === true ||
      isListed === '1' ||
      isListed === 1;

    await cat.save();

    console.log('editCategory:', id);
    return res.json({ success: true, message: 'Category updated', category: cat });
  } catch (err) {
    console.error('editCategory error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const editSubCategory = async (req, res) => {
  try {
    const id = req.params.id;
    const { fitName } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }
    if (!fitName) {
      return res.status(400).json({ success: false, message: 'Name required' });
    }

    const sub = await SubCategory.findById(id);
    if (!sub) {
      return res.status(404).json({ success: false, message: 'Subcategory not found' });
    }

    // unique fitName check
    if (String(sub.fitName) !== String(fitName.trim())) {
      const exists = await SubCategory.findOne({
        fitName: fitName.trim(),
        _id: { $ne: id }
      });
      if (exists) {
        return res.status(400).json({
          success: false,
          message: 'Another subcategory with this name already exists'
        });
      }
    }

    sub.fitName = fitName.trim();
    await sub.save();

    console.log('editSubCategory:', id);
    return res.json({ success: true, message: 'Subcategory updated', subcategory: sub });
  } catch (err) {
    console.error('editSubCategory error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const createCategory = async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !description) {
      return res.render('admin/categories', {
        categories: [],
        message: 'Name and description are required'
      });
    }

    const exists = await Category.findOne({ name: name.trim() });
    if (exists) {
      console.log('createCategory failed: category exists named', name);
      return res.render('admin/categories', {
        categories: [],
        message: 'Category already exists'
      });
    }

    await Category.create({
      name: name.trim(),
      description: description.trim(),
      isListed: true
    });

    console.log('createCategory: created', name);
    return res.redirect('/admin/category');
  } catch (err) {
    console.error('createCategory error:', err);
    return res.status(500).render('error-page', { message: 'Failed to create category' });
  }
};

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
      console.log('createSubCategory failed: subcategory exists', fitName);
      return res.redirect('/admin/category');
    }

    await SubCategory.create({
      Category: categoryId,
      fitName: fitName.trim()
    });

    console.log('createSubCategory: created', fitName);
    return res.redirect('/admin/category');
  } catch (err) {
    console.error('createSubCategory error:', err);
    return res.status(500).render('error-page', { message: 'Failed to create subcategory' });
  }
};

const toggleCategoryList = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.redirect('/admin/category');
    }

    const cat = await Category.findById(id);
    if (!cat) {
      return res.redirect('/admin/category');
    }

    cat.isListed = !cat.isListed;
    await cat.save();

    console.log('toggleCategoryList:', id, '->', cat.isListed);
    return res.redirect('/admin/category');
  } catch (err) {
    console.error('toggleCategoryList error:', err);
    return res.status(500).render('error-page', { message: 'Failed to toggle category' });
  }
};

// Set or clear an offer for a category
const setCategoryOffer = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.redirect('/admin/category');
    }

    const { offerType, offerValue, offerValidDate } = req.body;
    const cat = await Category.findById(id);
    if (!cat) {
      return res.redirect('/admin/category');
    }

    const valueTrim = (offerValue || '').toString().trim();
    if (!valueTrim) {
      cat.offerPrice = 0;
      cat.offerIsPercent = false;
      cat.offerValidDate = undefined;
      await cat.save();

      console.log('setCategoryOffer: cleared offer for', id);
      return res.redirect('/admin/category');
    }

    const numericValue = Number(valueTrim);
    if (Number.isNaN(numericValue) || numericValue < 0) {
      return res.render('categories', {
        categories: [],
        message: 'Invalid offer value'
      });
    }

    if (offerType === 'percent') {
      if (numericValue <= 0 || numericValue > 100) {
        return res.render('categories', {
          categories: [],
          message: 'Percentage must be between 1 and 100'
        });
      }
      cat.offerIsPercent = true;
      cat.offerPrice = numericValue;
    } else {
      cat.offerIsPercent = false;
      cat.offerPrice = numericValue;
    }

    cat.offerValidDate = offerValidDate
      ? new Date(offerValidDate)
      : undefined;

    await cat.save();

    console.log(
      'setCategoryOffer:',
      id,
      'value:',
      cat.offerPrice,
      'isPercent:',
      cat.offerIsPercent,
      'validUntil:',
      cat.offerValidDate
    );

    return res.redirect('/admin/category');
  } catch (err) {
    console.error('setCategoryOffer error:', err);
    return res.status(500).render('error-page', { message: 'Failed to set offer' });
  }
};

const getSubCategoryData = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }

    const sub = await SubCategory.findById(id).lean();
    if (!sub) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    return res.json({ success: true, subcategory: sub });
  } catch (err) {
    console.error('getSubCategoryData error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const deleteCategory = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category id'
      });
    }

    const productCount = await Product.countDocuments({ categoryId: id });
    if (productCount > 0) {
      return res.status(400).json({
        success: false,
        message:
          'Cannot delete category with products. Unlist products or move them first.'
      });
    }

    await SubCategory.deleteMany({ Category: id });
    await Category.findByIdAndDelete(id);

    console.log('deleteCategory:', id);
    return res.json({ success: true, message: 'Category deleted' });
  } catch (err) {
    console.error('deleteCategory error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const deleteSubCategory = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid subcategory id'
      });
    }

    const sub = await SubCategory.findById(id);
    if (!sub) {
      return res.status(404).json({
        success: false,
        message: 'Subcategory not found'
      });
    }

    const productsUsing = await Product.countDocuments({
      subcategoryId: String(id)
    });
    if (productsUsing > 0) {
      return res.status(400).json({
        success: false,
        message:
          'Cannot delete subcategory with products. Reassign or remove products first.'
      });
    }

    await SubCategory.findByIdAndDelete(id);

    console.log('deleteSubCategory:', id);
    return res.json({ success: true, message: 'Subcategory deleted' });
  } catch (err) {
    console.error('deleteSubCategory error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export {
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

export default{
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
