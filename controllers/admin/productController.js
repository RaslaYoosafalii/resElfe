const { Product, Varient } = require('../../models/productSchema');
const { Category } = require('../../models/categorySchema');
const { SubCategory } = require('../../models/categorySchema');
const mongoose = require('mongoose');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { upload, UPLOAD_DIR } = require('../../config/upload');

// view products
const listProducts = async (req, res) => {
  try {
    // populate category and subcategory for display
    const products = await Product.find().populate('categoryId').populate('subcategoryId').lean();
    return res.render('products-list', { products, message: null });
  } catch (err) {
    console.error('[ADMIN] listProducts error:', err);
    return res.status(500).render('error-page', { message: 'Failed to load products' });
  }
};

// load add product view
const loadAddProduct = async (req, res) => {
  try {
    const categories = await Category.find().lean();
    // optionally fetch subcategories list too
    const subcategories = await SubCategory.find().lean();
    return res.render('product-add', { categories, subcategories, message: null });
  } catch (err) {
    console.error('[ADMIN] loadAddProduct error:', err);
    return res.status(500).render('error-page', { message: 'Failed to load add product page' });
  }
};

/**
 * addProduct uses multer middleware to parse files.
 * Expect:
 * - productImages[] (3+ files / cropped blobs)
 * - variants (JSON string) e.g. [{size:'M',color:'Red',price:1000,stock:10}, ...]
 * - productName, description, categoryId, subcategoryId
 */
const addProduct = [
  // multer middleware: accept up to 10 images (we require >=3)
  upload.array('productImages', 10),
  async (req, res) => {
    try {
      const {
        productName,
        description,
        categoryId,
        subcategoryId,
        variants // variants expected as JSON string
      } = req.body;

      // Basic server-side validation
      if (!productName || !description || !categoryId || !subcategoryId) {
        // cleanup uploaded files
        (req.files || []).forEach(f => fs.unlinkSync(f.path));
        return res.status(400).render('product-add', { categories: await Category.find().lean(), subcategories: await SubCategory.find().lean(), message: 'Missing required fields' });
      }

      if (!mongoose.Types.ObjectId.isValid(categoryId) || !mongoose.Types.ObjectId.isValid(subcategoryId)) {
        (req.files || []).forEach(f => fs.unlinkSync(f.path));
        return res.status(400).render('product-add', { categories: await Category.find().lean(), subcategories: await SubCategory.find().lean(), message: 'Invalid category/subcategory' });
      }

      // parse variants
      let variantList = [];
      try {
        variantList = variants ? JSON.parse(variants) : [];
      } catch (e) {
        (req.files || []).forEach(f => fs.unlinkSync(f.path));
        return res.status(400).render('product-add', { categories: await Category.find().lean(), subcategories: await SubCategory.find().lean(), message: 'Invalid variants data' });
      }

      // validate variants: at least one variant, stock non-negative, price positive
      if (!Array.isArray(variantList) || variantList.length === 0) {
        (req.files || []).forEach(f => fs.unlinkSync(f.path));
        return res.status(400).render('product-add', { categories: await Category.find().lean(), subcategories: await SubCategory.find().lean(), message: 'Please add at least one variant' });
      }

      for (const v of variantList) {
        v.price = Number(v.price);
        v.discountPrice = (typeof v.discountPrice !== 'undefined' && v.discountPrice !== '' && v.discountPrice !== null) ? Number(v.discountPrice) : null;
        v.stock = Number(v.stock);
        if (!v.size || v.price <= 0 || isNaN(v.price) || isNaN(v.stock) || v.stock < 0) {
          (req.files || []).forEach(f => fs.unlinkSync(f.path));
          return res.status(400).render('product-add', { categories: await Category.find().lean(), subcategories: await SubCategory.find().lean(), message: 'Invalid variant values (price>0, stock>=0, size required)' });
        }
      }

      // images validation: at least 3 images
      const files = req.files || [];
      if (files.length < 3) {
        files.forEach(f => fs.unlinkSync(f.path));
        return res.status(400).render('product-add', { categories: await Category.find().lean(), subcategories: await SubCategory.find().lean(), message: 'At least 3 images are required' });
      }

      // Process images with sharp (resize & create thumbnail)
      const savedFilenames = [];
      for (const file of files) {
        const inPath = file.path;
        const outName = `prod-${Date.now()}-${path.basename(file.filename)}`;
        const outPath = path.join(UPLOAD_DIR, outName);

        // Resize to max 1200x1200 and save
        await sharp(inPath)
          .resize(1200, 1200, { fit: 'inside' })
          .toFile(outPath);

        // create a smaller thumbnail 800x800
        const thumbName = `thumb-${Date.now()}-${path.basename(file.filename)}`;
        const thumbPath = path.join(UPLOAD_DIR, thumbName);
        await sharp(inPath)
          .resize(800, 800, { fit: 'cover' })
          .toFile(thumbPath);

        // cleanup original upload
        try { fs.unlinkSync(inPath); } catch (e) { /* ignore */ }

        savedFilenames.push(outName);
        // optionally save thumbName somewhere (not required)
      }

      // create product document
      const newProduct = new Product({
        productName,
        description,
        categoryId,
        subcategoryId,
        images: savedFilenames,
        isListed: true,
        // other product fields can be set here
      });

      await newProduct.save();

      // create variants as separate varient docs linking to productId if you already store Varients as separate model
      // You have Varient model — create varients linking to newProduct._id
      const Varient = require('../../models/productSchema').Varient;
      const variantDocs = variantList.map(v => ({
        productId: newProduct._id,
        size: v.size,
        color: v.color || '',
        images: v.images || [], // optional per-variant images
        price: v.price,
        discountPrice: (typeof v.discountPrice !== 'undefined') ? v.discountPrice : null,
        stock: v.stock,
        isListed: true
      }));
      await Varient.insertMany(variantDocs);

      console.log('[ADMIN] addProduct: created', newProduct._id);
      return res.redirect('/admin/product');
    } catch (err) {
      console.error('[ADMIN] addProduct error:', err);
      // cleanup any uploaded files if exist
      (req.files || []).forEach(f => { try { fs.unlinkSync(f.path); } catch(e){ } });
      return res.status(500).render('error-page', { message: 'Failed to create product' });
    }
  }
];
// helper to remove a file safely
function safeUnlink(p) {
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch(e){ console.warn('unlink failed', p, e); }
}

// ========= LIST PRODUCTS (exclude soft-deleted) =========
// const listProducts = async (req, res) => {
//   try {
//     const products = await Product.find({ isDeleted: { $ne: true } })
//       .populate('categoryId')
//       .populate('subcategoryId')
//       .lean();
//     return res.render('products-list', { products, message: null });
//   } catch (err) {
//     console.error('[ADMIN] listProducts error:', err);
//     return res.status(500).render('error-page', { message: 'Failed to load products' });
//   }
// };

// ========= LOAD EDIT PAGE =========
// GET /admin/product/edit/:id
const loadEditProduct = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.redirect('/admin/product');

    const product = await Product.findById(id).lean();
    if (!product) return res.redirect('/admin/product');

    // fetch variants for this product
    const variants = await Varient.find({ productId: product._id }).lean();

    // categories and subcategories
    const categories = await Category.find().lean();
    const subcategories = await SubCategory.find().lean();

    return res.render('product-edit', {
      product,
      variants,
      categories,
      subcategories,
      message: null
    });
  } catch (err) {
    console.error('[ADMIN] loadEditProduct error:', err);
    return res.status(500).render('error-page', { message: 'Failed to load edit page' });
  }
};

// ========= UPDATE PRODUCT =========
// POST /admin/product/edit/:id
// Use same upload middleware as add: accept images to ADD (new uploads). Existing images are managed via form fields.
const updateProduct = [
  upload.array('productImages', 10),
  async (req, res) => {
    try {
      const id = req.params.id;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        (req.files || []).forEach(f => safeUnlink(f.path));
        return res.status(400).render('error-page', { message: 'Invalid product id' });
      }

      const product = await Product.findById(id);
      if (!product) {
        (req.files || []).forEach(f => safeUnlink(f.path));
        return res.status(404).render('error-page', { message: 'Product not found' });
      }

      const {
        productName,
        description,
        categoryId,
        subcategoryId,
        variants,            // JSON string of variants (with flags for existing/removed)
        existingImagesKeep   // optional list of filenames to keep (sent from form as JSON or hidden fields)
      } = req.body;

      // validate required fields
      if (!productName || !description || !categoryId || !subcategoryId) {
        (req.files || []).forEach(f => safeUnlink(f.path));
        return res.status(400).render('product-edit', {
          product: product.toObject(),
          variants: await Varient.find({ productId: id }).lean(),
          categories: await Category.find().lean(),
          subcategories: await SubCategory.find().lean(),
          message: 'Missing required fields'
        });
      }

      if (!mongoose.Types.ObjectId.isValid(categoryId) || !mongoose.Types.ObjectId.isValid(subcategoryId)) {
        (req.files || []).forEach(f => safeUnlink(f.path));
        return res.status(400).render('product-edit', {
          product: product.toObject(),
          variants: await Varient.find({ productId: id }).lean(),
          categories: await Category.find().lean(),
          subcategories: await SubCategory.find().lean(),
          message: 'Invalid category/subcategory'
        });
      }

      // parse variants array
      // Expected variants array items shape:
      // For existing variant: { _id: '...', size:'M', color:'', price:100, stock: 10, _delete: true/false }
      // For new variant: { size:'L', color:'', price:100, stock:5 }
      let variantList = [];
      try {
        variantList = variants ? JSON.parse(variants) : [];
      } catch (e) {
        (req.files || []).forEach(f => safeUnlink(f.path));
        return res.status(400).render('product-edit', {
          product: product.toObject(),
          variants: await Varient.find({ productId: id }).lean(),
          categories: await Category.find().lean(),
          subcategories: await SubCategory.find().lean(),
          message: 'Invalid variants data'
        });
      }

      // Validate variant values and build actions
      const toDeleteVariantIds = [];
      const toUpdateVariants = [];
      const toInsertVariants = [];

      for (const v of variantList) {
        if (v._id) {
          // existing variant
          if (v._delete) {
            toDeleteVariantIds.push(v._id);
            continue;
          }
          const price = Number(v.price);
          const discountPrice = (typeof v.discountPrice !== 'undefined' && v.discountPrice !== '' && v.discountPrice !== null) ? Number(v.discountPrice) : null;
          const stock = Number(v.stock);
          if (!v.size || price <= 0 || isNaN(price) || isNaN(stock) || stock < 0) {
            (req.files || []).forEach(f => safeUnlink(f.path));
            return res.status(400).render('product-edit', {
              product: product.toObject(),
              variants: await Varient.find({ productId: id }).lean(),
              categories: await Category.find().lean(),
              subcategories: await SubCategory.find().lean(),
              message: 'Invalid existing variant values (price>0, stock>=0, size required)'
            });
          }
          toUpdateVariants.push({ _id: v._id, size: v.size, color: v.color, price, discountPrice, stock });

        } else {
          // new variant
          const price = Number(v.price);
          const discountPrice = (typeof v.discountPrice !== 'undefined' && v.discountPrice !== '' && v.discountPrice !== null) ? Number(v.discountPrice) : null;
          const stock = Number(v.stock);
          if (!v.size || price <= 0 || isNaN(price) || isNaN(stock) || stock < 0) {
            (req.files || []).forEach(f => safeUnlink(f.path));
            return res.status(400).render('product-edit', {
              product: product.toObject(),
              variants: await Varient.find({ productId: id }).lean(),
              categories: await Category.find().lean(),
              subcategories: await SubCategory.find().lean(),
              message: 'Invalid new variant values (price>0, stock>=0, size required)'
            });
          }
          toInsertVariants.push({ size: v.size, color: v.color || '', price, discountPrice, stock });

        }
      }

      // handle images:
      // existingImagesKeep can be a JSON array or comma-separated string; convert to array
      let keep = [];
      if (existingImagesKeep) {
        try {
          keep = Array.isArray(existingImagesKeep) ? existingImagesKeep :
                 (existingImagesKeep.startsWith('[') ? JSON.parse(existingImagesKeep) : existingImagesKeep.split(','));
        } catch (e) {
          keep = [];
        }
      }

      // delete images not present in keep (soft remove from disk and product.images)
      const currentImages = Array.isArray(product.images) ? product.images.slice() : [];
      const toRemove = currentImages.filter(fn => !keep.includes(fn));
      for (const fn of toRemove) {
        safeUnlink(path.join(UPLOAD_DIR, fn));
      }

      // process uploaded new images (if any)
      const newFiles = req.files || [];
      const savedNewFilenames = [];
      for (const file of newFiles) {
        const inPath = file.path;
        const outName = `prod-${Date.now()}-${path.basename(file.filename)}`;
        const outPath = path.join(UPLOAD_DIR, outName);
        await sharp(inPath).resize(1200, 1200, { fit: 'inside' }).toFile(outPath);
        // thumbnail optional
        // cleanup original upload
        try { fs.unlinkSync(inPath); } catch (e) {}
        savedNewFilenames.push(outName);
      }

      // Compose final images array = keep + newly saved
      const finalImages = [...keep, ...savedNewFilenames];

      // Validate at least 1 image remains (or enforce >=3 if desired)
      if (finalImages.length < 1) {
        // you may require >=3; change number accordingly
        (newFiles || []).forEach(f => safeUnlink(f.path));
        return res.status(400).render('product-edit', {
          product: product.toObject(),
          variants: await Varient.find({ productId: id }).lean(),
          categories: await Category.find().lean(),
          subcategories: await SubCategory.find().lean(),
          message: 'At least one image must remain for the product'
        });
      }

      // All validation passed; update product
      product.productName = productName;
      product.description = description;
      product.categoryId = categoryId;
      product.subcategoryId = subcategoryId;
      product.images = finalImages;
      await product.save();

      // Apply variant deletions, updates, inserts
      if (toDeleteVariantIds.length) {
        await Varient.deleteMany({ _id: { $in: toDeleteVariantIds }, productId: product._id });
      }
      for (const uv of toUpdateVariants) {
        await Varient.findByIdAndUpdate(uv._id, { size: uv.size, color: uv.color, price: uv.price, discountPrice: (typeof uv.discountPrice !== 'undefined') ? uv.discountPrice : null, stock: uv.stock });

      }
      if (toInsertVariants.length) {
        const docs = toInsertVariants.map(v => ({ productId: product._id, size: v.size, color: v.color, price: v.price, discountPrice: (typeof v.discountPrice !== 'undefined') ? v.discountPrice : null, stock: v.stock, images: [], isListed: true }));
        await Varient.insertMany(docs);
      }

      console.log('[ADMIN] updateProduct:', id);
      return res.redirect('/admin/product');
    } catch (err) {
      console.error('[ADMIN] updateProduct error:', err);
      (req.files || []).forEach(f => safeUnlink(f.path));
      return res.status(500).render('error-page', { message: 'Failed to update product' });
    }
  }
];

// ========= SOFT DELETE PRODUCT =========
// POST /admin/product/delete/:id  => JSON { success:true/false, message }
const HARD_DELETE_REMOVE_FILES = true; // set false if you don't want image files removed physically

const deleteProduct = async (req, res) => {
  try {
    const id = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }

    const prod = await Product.findById(id);
    if (!prod) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    // ==============================
    // 1) DELETE product images from filesystem
    // ==============================
    if (HARD_DELETE_REMOVE_FILES && prod.images && prod.images.length) {
      prod.images.forEach(img => {
        const filePath = path.join(__dirname, '../../public/uploads/products/', img);
        fs.unlink(filePath, (err) => {
          if (err) console.log(`⚠️ Could not delete image: ${filePath}`);
        });
      });
    }

    // ==============================
    // 2) DELETE variants belonging to product
    // ==============================
    await Varient.deleteMany({ productId: id });

    // ==============================
    // 3) DELETE product from DB
    // ==============================
    await Product.deleteOne({ _id: id });

    console.log('[ADMIN] deleteProduct (HARD DELETE):', id);

    return res.json({ success: true, message: 'Product permanently deleted' });

  } catch (err) {
    console.error('[ADMIN] deleteProduct error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};



module.exports = {
    listProducts,
    loadAddProduct,
    addProduct,
    deleteProduct,
    updateProduct,
    loadEditProduct,
      
};
