
// controllers/admin/productController.js
import { Product, Variant } from '../../models/productSchema.js';
import { Category, SubCategory } from '../../models/categorySchema.js';
import mongoose from 'mongoose';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { upload, UPLOAD_DIR } from '../../config/upload.js';
import { fileURLToPath } from 'url';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const listProducts = async (req, res) => {
  try {
    let page = parseInt(req.query.page) || 1;
    let limit = 10;
    if (limit < 1) limit = 10;

    const search = req.query.search ? req.query.search.trim() : "";
    const skip = (page - 1) * limit;


// Build search filter
let findFilter = { isDeleted: { $ne: true } };

    // Count total before pagination
    const totalProducts = await Product.countDocuments(findFilter);
    const totalPages = Math.ceil(totalProducts / limit);

    // Fetch paginated products
    const products = await Product.find(findFilter)
      .populate("categoryId")
      .populate("subcategoryId")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    let filteredProducts = products;

    if (search) {
    const regex = new RegExp(search, "i");

     filteredProducts = products.filter(p =>
        regex.test(p.productName) ||
        regex.test(p.categoryId?.name || "") ||
        regex.test(p.subcategoryId?.fitName || "")
      );
    }

    //total stock
    const variants = await Variant.find({
      productId: { $in: products.map(p => p._id) }
    }).lean();

    const stockMap = {};
    variants.forEach(v => {
      const pid = v.productId.toString();
      if (!stockMap[pid]) stockMap[pid] = 0;
      stockMap[pid] += v.stock;
    });

    products.forEach(p => {
      p.totalStock = stockMap[p._id.toString()] || 0;
    });

    return res.render("products-list", {
      allowRender: true,
      products: filteredProducts,
      page,
      totalPages,
      limit,
      search,  
      message: null
    });

  } catch (err) {
    console.error("listProducts error:", err);
    return res.status(500).render("error-page", { message: "Failed to load products" });
  }
};


const loadAddProduct = async (req, res) => {
  try {
const categories = await Category.find({isDeleted: { $ne: true },isListed: true}).lean();
    // optionally fetch subcategories list too
    const subcategories = await SubCategory.find().lean();
    return res.render('product-add', {allowRender: true, categories, subcategories, message: null });
  } catch (err) {
    console.error('loadAddProduct error:', err);
    return res.status(500).render('error-page', { message: 'Failed to load add product page' });
  }
};


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
        return res.status(400).render('product-add', {allowRender: true, categories: await Category.find().lean(), subcategories: await SubCategory.find().lean(), message: 'Missing required fields' });
      }

      if (!mongoose.Types.ObjectId.isValid(categoryId) || !mongoose.Types.ObjectId.isValid(subcategoryId)) {
        (req.files || []).forEach(f => fs.unlinkSync(f.path));
        return res.status(400).render('product-add', {allowRender: true, categories: await Category.find().lean(), subcategories: await SubCategory.find().lean(), message: 'Invalid category/subcategory' });
      }

      // parse variants
      let variantList = [];
      try {
        variantList = variants ? JSON.parse(variants) : [];
      } catch (e) {
        (req.files || []).forEach(f => fs.unlinkSync(f.path));
        return res.status(400).render('product-add', {allowRender: true, categories: await Category.find().lean(), subcategories: await SubCategory.find().lean(), message: 'Invalid variants data' });
      }

      // validate variants: at least one variant, stock non-negative, price positive
      if (!Array.isArray(variantList) || variantList.length === 0) {
        (req.files || []).forEach(f => fs.unlinkSync(f.path));
        return res.status(400).render('product-add', {allowRender: true, categories: await Category.find().lean(), subcategories: await SubCategory.find().lean(), message: 'Please add at least one variant' });
      }

      for (const v of variantList) {
        v.price = Number(v.price);
        v.discountPrice = (typeof v.discountPrice !== 'undefined' && v.discountPrice !== '' && v.discountPrice !== null) ? Number(v.discountPrice) : null;
        v.stock = Number(v.stock);
        if (!v.size || v.price <= 0 || isNaN(v.price) || isNaN(v.stock) || v.stock < 0) {
          (req.files || []).forEach(f => fs.unlinkSync(f.path));
          return res.status(400).render('product-add', {allowRender: true, categories: await Category.find().lean(), subcategories: await SubCategory.find().lean(), message: 'Invalid variant values (price>0, stock>=0, size required)' });
        }
      }

      // images validation: at least 3 images
      const files = req.files || [];
      if (files.length < 3) {
        files.forEach(f => fs.unlinkSync(f.path));
        return res.status(400).render('product-add', {allowRender: true, categories: await Category.find().lean(), subcategories: await SubCategory.find().lean(), message: 'At least 3 images are required' });
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
      await Variant.insertMany(variantDocs);

      console.log('addProduct: created', newProduct._id);
      return res.redirect('/admin/product');
    } catch (err) {
      console.error('addProduct error:', err);
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




const loadEditProduct = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.redirect('/admin/product');

    const product = await Product.findById(id).lean();
    if (!product) return res.redirect('/admin/product');

    // fetch variants for this product
    const variants = await Variant.find({ productId: product._id }).lean();

    // categories and subcategories
    const categories = await Category.find({isDeleted: { $ne: true }, isListed: true}).lean();
    const subcategories = await SubCategory.find().lean();

    return res.render('product-edit', {
      allowRender: true,
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
        variants,          
        existingImagesKeep   // optional list of filenames to keep (sent from form as JSON or hidden fields)
      } = req.body;

      // validate required fields
      if (!productName || !description || !categoryId || !subcategoryId) {
        (req.files || []).forEach(f => safeUnlink(f.path));
        return res.status(400).render('product-edit', {
          allowRender: true,
          product: product.toObject(),
          variants: await Variant.find({ productId: id }).lean(),
          categories: await Category.find().lean(),
          subcategories: await SubCategory.find().lean(),
          message: 'Missing required fields'
        });
      }

      if (!mongoose.Types.ObjectId.isValid(categoryId) || !mongoose.Types.ObjectId.isValid(subcategoryId)) {
        (req.files || []).forEach(f => safeUnlink(f.path));
        return res.status(400).render('product-edit', {
          allowRender: true,
          product: product.toObject(),
          variants: await Variant.find({ productId: id }).lean(),
          categories: await Category.find().lean(),
          subcategories: await SubCategory.find().lean(),
          message: 'Invalid category/subcategory'
        });
      }

      // parse variants array
      let variantList = [];
      try {
        variantList = variants ? JSON.parse(variants) : [];
      } catch (e) {
        (req.files || []).forEach(f => safeUnlink(f.path));
        return res.status(400).render('product-edit', {
          allowRender: true,
          product: product.toObject(),
          variants: await Variant.find({ productId: id }).lean(),
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
              allowRender: true,
              product: product.toObject(),
              variants: await Variant.find({ productId: id }).lean(),
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
              allowRender: true,
              product: product.toObject(),
              variants: await Variant.find({ productId: id }).lean(),
              categories: await Category.find().lean(),
              subcategories: await SubCategory.find().lean(),
              message: 'Invalid new variant values (price>0, stock>=0, size required)'
            });
          }
          toInsertVariants.push({ size: v.size, color: v.color || '', price, discountPrice, stock });

        }
      }

      // handle images
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
          allowRender: true,
          product: product.toObject(),
          variants: await Variant.find({ productId: id }).lean(),
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
        await Variant.deleteMany({ _id: { $in: toDeleteVariantIds }, productId: product._id });
      }
      for (const uv of toUpdateVariants) {
        await Variant.findByIdAndUpdate(uv._id, { size: uv.size, color: uv.color, price: uv.price, discountPrice: (typeof uv.discountPrice !== 'undefined') ? uv.discountPrice : null, stock: uv.stock });

      }
      if (toInsertVariants.length) {
        const docs = toInsertVariants.map(v => ({ productId: product._id, size: v.size, color: v.color, price: v.price, discountPrice: (typeof v.discountPrice !== 'undefined') ? v.discountPrice : null, stock: v.stock, images: [], isListed: true }));
        await Variant.insertMany(docs);
      }

      console.log('updateProduct:', id);
      return res.redirect('/admin/product');
    } catch (err) {
      console.error('updateProduct error:', err);
      (req.files || []).forEach(f => safeUnlink(f.path));
      return res.status(500).render('error-page', { message: 'Failed to update product' });
    }
  }
];


// const HARD_DELETE_REMOVE_FILES = true; 

const deleteProduct = async (req, res) => {
  try {
    const id = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }


    //soft delete
    product.isDeleted = true;
    product.isListed = false; 
    await product.save();

    // unlist variants
    await Variant.updateMany(
      { productId: id },
      { $set: { isListed: false } }
    );



    console.log('delete Product:', id);

    return res.json({ success: true, message: 'Product deleted' });

  } catch (err) {
    console.error('deleteProduct error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};


const restoreProduct = async (req, res) => {
  try {
    const id = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    if (!product.isDeleted) {
      return res.json({ success: true, message: 'Product already active' });
    }

    //restore product
    product.isDeleted = false;
    product.isListed = true;
    await product.save();

    //restore variant
    await Variant.updateMany(
      { productId: id },
      { $set: { isListed: true } }
    );

    console.log('restoreProduct:', id);

    return res.json({
      success: true,
      message: 'Product restored successfully'
    });

    
  } catch (err) {
    console.error('restoreProduct error:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

const listDeletedProducts = async (req, res) => {
  try {
    const products = await Product.find({ isDeleted: true })
      .populate("categoryId")
      .populate("subcategoryId")
      .sort({ updatedAt: -1 })
      .lean();

    return res.render("products-deleted", {
      allowRender: true,
      products
    });
  } catch (err) {
    console.error("listDeletedProducts error:", err);
    return res.status(500).render("error-page", {
      message: "Failed to load deleted products"
    });
  }
};



export {
  listProducts,
  loadAddProduct,
  addProduct,
  deleteProduct,
  updateProduct,
  loadEditProduct,
  restoreProduct,
  listDeletedProducts
};

export default{
  listProducts,
  loadAddProduct,
  addProduct,
  deleteProduct,
  updateProduct,
  loadEditProduct,
  restoreProduct,
  listDeletedProducts
};