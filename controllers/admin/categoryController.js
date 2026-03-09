// controllers/admin/categoryController.js
import { Category, SubCategory } from '../../models/categorySchema.js';
import { Product } from '../../models/productSchema.js';
import mongoose from 'mongoose';
import logger from '../../config/logger.js';
import STATUS_CODES from '../../utils/statusCodes.js';

function parsePaging(req) {
  const page = Math.max(parseInt(req.query.page || '1', 10), 1);
  const limit = Math.max(parseInt(req.query.limit || '10', 10), 1);
  const q = (req.query.q || '').toString().trim();
  return { page, limit, q };
}
const isValidString = v => typeof v === 'string' && v.trim().length > 0;
const alpha = /[a-zA-Z]/;


const listCategories = async (req, res) => {
  try {
    const { page,  q } = parsePaging(req);
    const limit = 3;
  
    const filter = { isDeleted: { $ne: true } };  

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

    //clear expired offers
    const now = new Date();
    await Category.updateMany(
      {
        offerValidDate: { $lt: now },
        offerPrice: { $gt: 0 }
      },
      {
        $set: {
          offerPrice: 0,
          offerIsPercent: false
        },
        $unset: {
          offerValidDate: ''
        }
      }
    );

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

    const totalPages = Math.ceil(total / limit);
  
    const message = req.session.message || null;
    req.session.message = null;
    
    return res.render('categories', {
      allowRender: true, 
      categories: categoriesWithMeta,
      message,
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
    logger.error(`listCategories function error: ${err.message}`);
    return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).render('error-page', { message: 'Failed to load categories' });
  }
};

const getCategoryData = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(STATUS_CODES.BAD_REQUEST).json({ success: false, message: 'Invalid id' });
    }

    const cat = await Category.findById(id).lean();
    if (!cat) {
      return res.status(STATUS_CODES.NOT_FOUND).json({ success: false, message: 'Category not found' });
    }

    const subcategories = await SubCategory.find({ Category: id }).lean();

    return res.json({ success: true, category: cat, subcategories });
  } catch (err) {
    console.error('getCategoryData function error:', err);
    logger.error(`getCategoryData function error: ${err.message}`);
    return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Server error' });
  }
};

const editCategory = async (req, res) => {
  try {
    const id = req.params.id;
    const { name, description, isListed } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(STATUS_CODES.BAD_REQUEST).json({ success: false, message: 'Invalid id' });
    }
    if (!isValidString(name) || !isValidString(description)) {
      return res.status(STATUS_CODES.BAD_REQUEST).json({ success: false, message: 'Name and description required' });
    }

    const cat = await Category.findById(id);
    if (!cat) {
      return res.status(STATUS_CODES.NOT_FOUND).json({ success: false, message: 'Category not found' });
    }

    // check unique name (if changed)
    if (cat.name.toLowerCase() !== name.trim().toLowerCase()) {

      const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const exists = await Category.findOne({
        name: { $regex: new RegExp(`^${escaped}$`, 'i') },
        _id: { $ne: id },
        isDeleted: { $ne: true }
      });

      if (exists) {
        return res.status(STATUS_CODES.BAD_REQUEST).json({
          success: false,
          message: 'Another category with this name already exists'
        });
      }
    }

    const newStatus =
  isListed === 'true' ||
  isListed === true ||
  isListed === '1' ||
  isListed === 1;

    const statusChanged = cat.isListed !== newStatus;

    cat.name = name.trim();
    cat.description = description.trim();
    cat.isListed = newStatus;

    await cat.save();

    if (statusChanged) {
      await Product.updateMany(
        { categoryId: cat._id },
        { $set: { isListed: newStatus } }
      );
    }
    console.log('editCategory:', id);
    return res.json({ success: true, message: 'Category updated', category: cat });
  } catch (err) {
    console.error('editCategory error:', err);
    logger.error(`editCategory error: ${err.message}`);
    return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Server error' });
  }
};

const editSubCategory = async (req, res) => {
  try {
    const id = req.params.id;
    const { fitName } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(STATUS_CODES.BAD_REQUEST).json({ success: false, message: 'Invalid id' });
    }
    if (!isValidString(fitName) ) {
      return res.status(STATUS_CODES.BAD_REQUEST).json({ success: false, message: 'Name required' });
    }

    const sub = await SubCategory.findById(id);
    if (!sub) {
      return res.status(STATUS_CODES.NOT_FOUND).json({ success: false, message: 'Subcategory not found' });
    }

    // unique fitName check
    if (sub.fitName.toLowerCase() !== fitName.trim().toLowerCase()) {

      const escaped = fitName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const exists = await SubCategory.findOne({
        Category: sub.Category,
        fitName: { $regex: new RegExp(`^${escaped}$`, 'i') },
        _id: { $ne: id }
      });

      if (exists) {
        return res.status(STATUS_CODES.BAD_REQUEST).json({
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
    logger.error(`editSubCategory error: ${err.message}`);
    return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Server error' });
  }
};

const createCategory = async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!isValidString(name) || !isValidString(description)) {
      req.session.message = 'Name and description are required';
      return res.redirect('/admin/category');
    }
    if (!alpha.test(name)) {
      req.session.message = 'enter a valid category name';
      return res.redirect('/admin/category');
    }

    const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exists = await Category.findOne({
      name: { $regex: new RegExp(`^${escaped}$`, 'i') },
      isDeleted: { $ne: true }
    });

    if (exists) {
      console.log('createCategory failed: category exists named', name);
      req.session.message = 'category already exists with same name';
      return res.redirect('/admin/category');
    }

    await Category.create({
      name: name.trim(),
      description: description.trim(),
      isListed: true
    });

    req.session.message = 'Category added successfully';

    console.log('createCategory: created', name);
    return res.redirect('/admin/category');
  } catch (err) {
    console.error('createCategory error:', err);
    logger.error(`createCategory error: ${err.message}`);
    return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).render('error-page', { message: 'Failed to create category' });
  }
};

const createSubCategory = async (req, res) => {
  try {
    const { categoryId, fitName } = req.body;

    if (!categoryId || !alpha.test(fitName)) {
      req.session.message = 'please enter a valid subcategory name';
      return res.redirect('/admin/category');
    }
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.redirect('/admin/category');
    }

    const escaped = fitName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exists = await SubCategory.findOne({
      Category: categoryId,
      fitName: { $regex: new RegExp(`^${escaped}$`, 'i') }
    });

    if (exists) {
      console.log('createSubCategory failed: subcategory exists', fitName);
      req.session.message = 'subcategory already exists with same name';
      return res.redirect('/admin/category');
    }

    await SubCategory.create({
      Category: categoryId,
      fitName: fitName.trim()
    });
  
    req.session.message = 'Subcategory added successfully';
   
    console.log('createSubCategory: created', fitName);
    return res.redirect('/admin/category');
  } catch (err) {
    console.error('createSubCategory error:', err);
    logger.error(`createSubCategory error: ${err.message}`);
    return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).render('error-page', { message: 'Failed to create subcategory' });
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
    
    
    const newStatus = !cat.isListed;
    cat.isListed = newStatus;
    await cat.save();


    await Product.updateMany(
      { categoryId: cat._id},
      { $set: { isListed: newStatus } }
    );
  
    console.log('toggleCategoryList:', id, '->', cat.isListed);
    // AJAX request
    if (req.xhr || req.headers['x-requested-with'] === 'XMLHttpRequest') {
      return res.json({
        success: true,
        message: 'Category status updated',
        isListed: newStatus
      });
    }
    return res.redirect('/admin/category');
  } catch (err) {
    console.error('toggleCategoryList error:', err);
    logger.error(`toggleCategoryList error: ${err.message}`);
    return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).render('error-page', { message: 'Failed to toggle category' });
  }
};


const setCategoryOffer = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.redirect('/admin/category');
    }

    const { offerType, offerValue, offerValidDate, minProductPrice } = req.body;

    if (offerType && !['fixed', 'percent'].includes(offerType)) {
      req.session.message = 'Invalid offer type';
      return res.redirect('/admin/category');
    }

    const cat = await Category.findById(id);
    if (!cat) {
      return res.redirect('/admin/category');
    }

    const valueTrim = (offerValue || '').toString().trim();
    const dateTrim = (offerValidDate || '').toString().trim();

    // clear offer
    if (!valueTrim && !dateTrim) {
      cat.offerPrice = 0;
      cat.offerIsPercent = false;
      cat.offerValidDate = undefined;
      cat.minProductPrice = null;
  
      await cat.save();

      req.session.message = 'Offer cleared successfully';
      return res.redirect('/admin/category');
    }


    if (!valueTrim || !dateTrim) {
      req.session.message = 'Offer value and valid date are required';
      return res.redirect('/admin/category');
    }


    const numericValue = Number(valueTrim);

    if (Number.isNaN(numericValue) || numericValue < 0) {
      req.session.message = 'Invalid offer value';
      return res.redirect('/admin/category');
    }

    if (offerType === 'percent') {

      if (numericValue > 100) {
        req.session.message = 'Percentage value must be between 1 and 100';
        return res.redirect('/admin/category');
      }

      cat.offerIsPercent = true;
      cat.offerPrice = numericValue;
      cat.minProductPrice = null; // not required for percent

    } else {

      //fixed
      const minTrim = (minProductPrice || '').toString().trim();

      if (!minTrim) {
        req.session.message = 'Minimum product price is required for fixed offers';
        return res.redirect('/admin/category');
      }

      const numericMin = Number(minTrim);

      if (Number.isNaN(numericMin) || numericMin <= 0) {
        req.session.message = 'Minimum product price must be greater than 0';
        return res.redirect('/admin/category');
      }

      if (numericMin <= numericValue) {
        req.session.message = 'Minimum product price must be greater than offer value';
        return res.redirect('/admin/category');
      }

      cat.offerIsPercent = false;
      cat.offerPrice = numericValue;
      cat.minProductPrice = numericMin;
    }

    if (offerValidDate) {
      const d = new Date(offerValidDate);

      if (isNaN(d.getTime())) {
        req.session.message = 'Invalid offer date';
        return res.redirect('/admin/category');
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      d.setHours(0, 0, 0, 0);

      if (d <= today) {
        req.session.message = 'Offer valid date must be a future date';
        return res.redirect('/admin/category');
      }

      cat.offerValidDate = d;
    } else {
      cat.offerValidDate = undefined;
    }



    await cat.save();

    req.session.message = 'Offer created successfully';

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
    logger.error(`setCategoryOffer error: ${err.message}`);
    req.session.message = 'Error creating offer';
    return res.redirect('/admin/category');
  }

};

const getSubCategoryData = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(STATUS_CODES.BAD_REQUEST).json({ success: false, message: 'Invalid id' });
    }

    const sub = await SubCategory.findById(id).lean();
    if (!sub) {
      return res.status(STATUS_CODES.NOT_FOUND).json({ success: false, message: 'Not found' });
    }

    return res.json({ success: true, subcategory: sub });
  } catch (err) {
    console.error('getSubCategoryData error:', err);
    logger.error(`getSubCategoryData error: ${err.message}`);
    return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Server error' });
  }
};

const deleteCategory = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: 'Invalid category id'
      });
    }
 
    const category = await Category.findById(id);
    if (!category) {
      return res.status(STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: 'Category not found'
      });
    }

    const productCount = await Product.countDocuments({ categoryId: id });
    if (productCount > 0) {
      return res.status(STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message:
          'Cannot delete category with products. Unlist products or move them first.'
      });
    }

    category.isDeleted = true;
    category.isListed = false;
    await category.save();

    console.log('deleteCategory:', id);
    return res.json({ success: true, message: 'Category deleted' });

  } catch (err) {
    console.error('deleteCategory error:', err);
    logger.error(`deleteCategory error: ${err.message}`);
    return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Server error' });
  }
};

const deleteSubCategory = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: 'Invalid subcategory id'
      });
    }

    const sub = await SubCategory.findById(id);
    if (!sub) {
      return res.status(STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: 'Subcategory not found'
      });
    }

    const productsUsing = await Product.countDocuments({
      subcategoryId: String(id)
    });
    if (productsUsing > 0) {
      return res.status(STATUS_CODES.BAD_REQUEST).json({
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
    return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Server error' });
  }
};

const restoreCategory = async (req, res) => {
  try {
    const id = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: 'Invalid category id'
      });
    }

    const category = await Category.findById(id);
    if (!category) {
      return res.status(STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: 'Category not found'
      });
    }

    if (!category.isDeleted) {
      return res.json({
        success: true,
        message: 'Category already active'
      });
    }

    category.isDeleted = false;
    category.isListed = true;
    await category.save();

    await Product.updateMany(
      { categoryId: category._id },
      { $set: { isListed: true } }
    );



    console.log('restoreCategory:', id);

    return res.json({
      success: true,
      message: 'Category restored successfully'
    });

  } catch (err) {
    console.error('restoreCategory error:', err);
    logger.error(`restoreCategory error: ${err.message}`);
    return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Server error'
    });
  }
};
const listDeletedCategories = async (req, res) => {
  try {
    const categories = await Category.find({ isDeleted: true })
      .sort({ createdAt: -1 })
      .lean();

    return res.render('categories-deleted', {
      allowRender: true,
      categories
    });
  } catch (err) {
    console.error('listDeletedCategories error:', err);
    logger.error(`listDeletedCategories error: ${err.message}`);
    return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).render('error-page', {
      message: 'Failed to load deleted categories'
    });
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
  restoreCategory,
  getCategoryData,
  editCategory,
  editSubCategory,
  getSubCategoryData,
  listDeletedCategories
};

export default{
  listCategories,
  createCategory,
  createSubCategory,
  toggleCategoryList,
  setCategoryOffer,
  deleteCategory,
  deleteSubCategory,
  restoreCategory,
  getCategoryData,
  editCategory,
  editSubCategory,
  getSubCategoryData,
  listDeletedCategories

};
