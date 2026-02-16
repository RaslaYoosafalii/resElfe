import mongoose from 'mongoose';
const {Schema} = mongoose;

const couponSchema = new Schema({
   
     startingDate: {
        type: Date,
        default: Date.now,
        required: true
     },
     validUntil: {
           type: Date,
        required: true
     },
     minimumPurchase:{
        type: Number,
        required: true
     },
     maximumDiscount: {
        type: Number,
        required: true
     },
     description:{
        type:String,
        required:true,
     },
     code:{
        type: String,
        required: true,
    },
    discountType: {
        type: String,
        enum:  [ 'percentage', 'fixed'],
        default: 'fixed'
    },
    usageLimit: {
         type: Number,
         default: 1 
    },
    usedCount: { 
         type: Number,
         default: 0 
    },
    redeemedUsers: [{
          userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          count: { type: Number, default: 0 } 
    }],
    isDeleted: {
          type: Boolean,
          default: false
    },
    discountValue: {
          type: Number,
          required: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now,
        required: true
    },
    updatedAt: {
        type: Date
    }
})
couponSchema.index(
  { code: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false }
  }
);

const Coupon = mongoose.model('Coupon', couponSchema);

export { 
   Coupon
};