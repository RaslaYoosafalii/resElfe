import { Coupon } from "../../models/couponSchema.js";


const listCoupons = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 8;
    const skip = (page - 1) * limit;

const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
const status = typeof req.query.status === "string" ? req.query.status.trim().toLowerCase() : "";
const type = typeof req.query.type === "string" ? req.query.type.trim().toLowerCase() : "";


let query = { isDeleted: false };

if (search.length > 0) {

  //prevent symbols
  const cleanSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  query.$or = [
    { description: { $regex: cleanSearch, $options: "i" } },
    { code: { $regex: cleanSearch, $options: "i" } }
  ];
}
//type filter
if (type) {
  const allowedTypes = ["fixed", "percentage"];

  if (!allowedTypes.includes(type)) {
    return res.redirect("/admin/errorPage");
  }

  query.discountType = type;
}
//status
if (status) {
  const allowedStatus = ["active", "inactive", "expired"];

  if (!allowedStatus.includes(status)) {
    return res.redirect("/admin/errorPage");
  }

  const now = new Date();

  if (status === "expired") {
    query.validUntil = { $lt: now };
  } else if (status === "active") {
    query.validUntil = { $gte: now };
    query.isActive = true;
  } else if (status === "inactive") {
    query.validUntil = { $gte: now };
    query.isActive = false;
  }
}

    const coupons = await Coupon.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const totalCoupons = await Coupon.countDocuments(query);
    const totalPages = Math.ceil(totalCoupons / limit);

res.render("coupons-list", {
  coupons,
  page,
  totalPages,
  search,
  status,
  type,
  allowRender: true
});

  } catch (error) {
    console.error("listCoupons error", error);
    res.redirect("/admin/errorPage");
  }
};



const deleteCoupon = async (req, res) => {
  try {
    const { id } = req.params;

    const coupon = await Coupon.findById(id);
    if (!coupon) {
      return res.json({ 
        success: false, 
        message: "The selected coupon does not exist." 
      });
    }

    if (coupon.isDeleted) {
      return res.json({ success: true });
    }

    coupon.isDeleted = true;
    coupon.updatedAt = new Date();

    await coupon.save();

    return res.json({ success: true });

  } catch (error) {
    console.error("deleteCoupon error", error);

    return res.json({
      success: false,
      message: "Unable to delete coupon. Please try again."
    });
  }
};



const addCoupon = async (req, res) => {
  try {

    const {
      description,
      code,
      discountType,
      discountValue,
      minimumPurchase,
      maximumDiscount,
      usageLimit,
      startingDate,
      validUntil
    } = req.body;

    const errors = {};

    //description validation
    if (!description || !description.trim()) {
       errors.description = "Description is required";
    }


    // ===== CODE VALIDATION =====
    if (!code || !code.trim()) {
      errors.code = "Coupon code is required";
    }

    const upperCode = code?.trim().toUpperCase();

    if (upperCode) {
      const existing = await Coupon.findOne({ 
         code: upperCode,
         isDeleted: false
      });

      if (existing) {
        errors.code = "Coupon code already exists";
      }
    }

    // ===== DISCOUNT TYPE =====
    if (!['fixed', 'percentage'].includes(discountType)) {
      errors.discountType = "Invalid discount type";
    }

const value = Number(discountValue);

if (isNaN(value) || value <= 0) {
  errors.discountValue = "Discount value must be greater than 0";
}

if (discountType === "percentage" && (value < 1 || value > 100)) {
  errors.discountValue = "Percentage discount must be between 1 and 100";
}


    const min = Number(minimumPurchase);
    const max = Number(maximumDiscount);
    const limit = Number(usageLimit);

    if (isNaN(min) || min < 0) {
      errors.minimumPurchase = "Minimum purchase must be 0 or more";
    }

    if (isNaN(max) || max < 0) {
      errors.maximumDiscount = "Maximum discount must be 0 or more";
    }

if (limit !== 0 && (isNaN(limit) || limit < 1)) {
  errors.usageLimit = "Usage limit must be at least 1";
}


    const start = new Date(startingDate);
    const end = new Date(validUntil);

    if (!startingDate) {
      errors.startingDate = "Starting date is required";
    }

    if (!validUntil) {
      errors.validUntil = "Expiry date is required";
    }

    if (start && end && start > end) {
      errors.validUntil = "Expiry must be after starting date";
    }

    if (end && end < new Date()) {
      errors.validUntil = "Expiry must be future date";
    }

    // ===== IF ANY ERRORS RETURN =====
    if (Object.keys(errors).length > 0) {
      return res.json({ success: false, errors });
    }

    await Coupon.create({
      description: description.trim(),
      code: upperCode,
      discountType,
      discountValue: value,
      minimumPurchase: min,
      maximumDiscount: max,
      usageLimit: limit,
      startingDate: start,
      validUntil: end
    });

    res.json({ success: true });

} catch (err) {
  console.error("addCoupon error:", err);

  res.json({
    success: false,
    message: err.message || "Server error"
  });
}
};

const editCoupon = async (req, res) => {
  try {

    const { id } = req.params;

    const {
      description,
      code,
      discountType,
      discountValue,
      minimumPurchase,
      maximumDiscount,
      usageLimit,
      startingDate,
      validUntil
    } = req.body;

    const coupon = await Coupon.findById(id);
    if (!coupon) {
      return res.json({ success:false, message:"Coupon not found" });
    }

    const errors = {};

    if (!description || !description.trim()) {
      errors.description = "Description is required";
    }


    if (!code || !code.trim()) {
      errors.code = "Coupon code is required";
    }

    const upperCode = code?.trim().toUpperCase();

    const existing = await Coupon.findOne({
          code: upperCode,
          isDeleted: false,
          _id: { $ne: id }
    });


    if (existing) {
      errors.code = "Coupon code already exists";
    }

    if (!['fixed', 'percentage'].includes(discountType)) {
      errors.discountType = "Invalid discount type";
    }

    const value = Number(discountValue);
    const min = Number(minimumPurchase);
    const max = Number(maximumDiscount);
    const limit = Number(usageLimit);


if (isNaN(value) || value <= 0) {
  errors.discountValue = "Discount value must be greater than 0";
}

if (discountType === "percentage" && (value < 1 || value > 100)) {
  errors.discountValue = "Percentage discount must be between 1 and 100";
}


    if (isNaN(min) || min < 0) {
      errors.minimumPurchase = "Minimum purchase must be 0 or more";
    }

    if (isNaN(max) || max < 0) {
      errors.maximumDiscount = "Maximum discount must be 0 or more";
    }

if (limit !== 0 && (isNaN(limit) || limit < 1)) {
  errors.usageLimit = "Usage limit per user must be at least 1";
}


    const start = new Date(startingDate);
    const end = new Date(validUntil);

    if (start > end) {
      errors.validUntil = "Expiry must be after starting date";
    }

    if (Object.keys(errors).length > 0) {
      return res.json({ success:false, errors });
    }

    coupon.description = description.trim();
    coupon.code = upperCode;
    coupon.discountType = discountType;
    coupon.discountValue = value;
    coupon.minimumPurchase = min;
    coupon.maximumDiscount = max;
    coupon.usageLimit = limit;
    coupon.startingDate = start;
    coupon.validUntil = end;
    coupon.updatedAt = new Date();

    await coupon.save();

    res.json({ success:true });

} catch (err) {
  console.error("editCoupon error:", err);

  res.json({
    success: false,
    message: err.message || "Update failed"
  });
}
};

const toggleStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const coupon = await Coupon.findById(id);
    if (!coupon) {
      return res.json({ success:false });
    }
    if (coupon.validUntil < new Date()) {
    return res.json({ success:false, message:"Expired coupon cannot be toggled" });
    }

    coupon.isActive = !coupon.isActive;
    await coupon.save();

    res.json({ success:true });

  } catch (err) {
    res.json({ success:false });
  }
};


export {
  listCoupons,
  deleteCoupon,
  addCoupon,
  editCoupon,
  toggleStatus
};

export default {
  listCoupons,
  deleteCoupon,
  addCoupon,
  editCoupon,
  toggleStatus
};