const mongoose = require('mongoose');
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
     name:{
        type:String,
        required:true,
     },
     code:{
        type: String,
        required: true,
        unique: true,
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
    createdAt: {
        type: Date,
        default: Date.now,
        required: true
    },
    updatedAt: {
        type: Date
    }
})