import express from 'express';

import adminController from '../controllers/admin/adminController.js'
import customerController from '../controllers/admin/customerController.js'
import categoryController from '../controllers/admin/categoryController.js';
import productController from '../controllers/admin/productController.js';
import orderController from '../controllers/admin/orderController.js';
import couponController from '../controllers/admin/couponController.js';
import {adminAuth, noCache} from '../middlewares/auth.js'
import salesController from '../controllers/admin/salesController.js';

const router = express.Router()

router.use((req, res, next) => {
  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate, private, max-age=0'
  );
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('X-Accel-Expires', '0');

  next();
});



router.get('/errorPage', adminController.errorPage);


router.get('/login', noCache, adminController.loadLogin);
router.post('/login', adminController.login);
router.get('/', noCache, adminAuth, adminController.loadDashboard);
router.get('/logout', adminController.logout)

router.get('/forgot-password', adminController.loadAdminForgotPassword);
router.post('/forgot-password', adminController.adminForgotPasswordRequest);

router.get('/verify-otp', adminController.loadAdminOtpPage);
router.post('/verify-otp', adminController.adminVerifyOtp);
router.post('/resend-otp', adminController.adminResendOtp);


router.post('/change-password', adminController.adminChangePassword);

router.get('/change-password', (req, res) => {
  if (!req.session.adminResetEmail) {
    return res.redirect('/admin/login');
  }
  res.render('admin-change-password');
});


//customer management
router.get('/customer', noCache, adminAuth, customerController.customerInfo);
router.patch('/customer/:id/block', adminAuth, customerController.toggleBlockUser);
router.delete('/customer/:id', adminAuth, customerController.deleteCustomer);


//category management
router.get('/category',noCache, adminAuth, categoryController.listCategories)
router.post('/category/create', adminAuth, categoryController.createCategory);
router.post('/category/subcreate', adminAuth, categoryController.createSubCategory)
router.post('/category/toggle/:id', adminAuth, categoryController.toggleCategoryList)
router.post('/category/offer/:id', adminAuth, categoryController.setCategoryOffer)
router.get('/category/data/:id',noCache, adminAuth, categoryController.getCategoryData);        
router.patch('/category/edit/:id', adminAuth, categoryController.editCategory);
router.patch('/category/subedit/:id', adminAuth, categoryController.editSubCategory);
router.delete('/category/delete/:id', adminAuth, categoryController.deleteCategory);
router.post('/category/restore/:id',adminAuth,categoryController.restoreCategory);
router.delete('/category/subdelete/:id', adminAuth, categoryController.deleteSubCategory);
router.get('/category/subdata/:id',noCache, adminAuth, categoryController.getSubCategoryData);
router.get('/category/deleted',noCache, adminAuth,categoryController.listDeletedCategories);



// Product management
router.get('/product',noCache, adminAuth, productController.listProducts);         
router.get('/product/add',noCache, adminAuth, productController.loadAddProduct);    
router.post('/product/add', adminAuth, productController.addProduct);    
router.get('/product/edit/:id',noCache, adminAuth, productController.loadEditProduct);
router.put('/product/edit/:id', adminAuth, productController.updateProduct);
router.delete('/product/delete/:id', adminAuth, productController.deleteProduct);
router.post('/product/restore/:id',adminAuth,productController.restoreProduct);
router.get('/product/deleted',noCache,adminAuth,productController.listDeletedProducts);


// Order management
router.get("/order",noCache, adminAuth, orderController.listOrders);
router.post("/order/status/:id", adminAuth, orderController.updateOrderStatus);
router.get("/order/:id",noCache, adminAuth, orderController.viewOrderDetails);

//return/refund management
router.get("/refund", noCache, adminAuth, orderController.loadReturnRefunds);
router.post("/refund/action", adminAuth, orderController.handleReturnAction);

//coupon management
router.get('/coupon', noCache, adminAuth, couponController.listCoupons);
router.delete('/coupon/delete/:id', adminAuth, couponController.deleteCoupon);
router.post('/coupon/add', adminAuth, couponController.addCoupon);
router.put('/coupon/edit/:id', adminAuth, couponController.editCoupon);
router.post("/coupon/toggle/:id", couponController.toggleStatus);

//sales management
router.get('/sales-report', salesController.loadSalesReport);
router.get('/sales-report/download', salesController.downloadSalesReport);

export default router;