import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid'; //npm package used for generating universally unique ids
const { Schema } = mongoose;

const orderSchema = new Schema({
    orderId: {
        type: String,
        default: ()=> uuidv4(),
        unique: true
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    orderedItem: [{
         product: {
            type: Schema.Types.ObjectId,
            ref: 'Product',
            required: true
        },
         productName: { 
            type: String,
            required: true
        },
        productImages: [{ 
            type: String
        }],
        size: {                    
          type: String,
          required: true
        },
        color: {                    
         type: String,
         required: true
        },      
        price: {
            type: Number,
            default: 0
        },
        basePrice: {
        type: Number,
        required: true
        },
        quantity: {
            type: Number,
            required: true
        },
        offerPrice: {
            type: Number,
            required: true,
        },
        couponShare: {
            type: Number,
            default: 0
        },

        orderStatus: {
            type: String,
            enum: ['pending','shipped','out for delivery', 'delivered', 'cancelled', 'returnRequested','rejected', 'returned','failed'],
            default: 'pending'
        }, 
        returnReason: {   
            type: String,
            default: "",
        },
        cancellationReason: {
            type: String,
            default: "",
        },
        deliveredOn: {
            type: Date
        }
    }],
    orderDate: {
        type: Date,
        default: Date.now
    },
    itemsTotal: {
        type: Number,
        required: true
    },
    discount: {
        type: Number,
        default: 0
    },
    shippingCharge: {
        type: Number,
        default: 0
    },
    finalPrice: {
        type: Number,
        required: true
    },
    address: {
        type: Schema.Types.Mixed,
        required: true
    },
    paymentMethod: {
        type: String,
        enum: ["cod", "wallet", "razorpay"],
        default: "cod",
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'refunded'],
        default: 'pending'
    },
    orderStatus: {
        type: String,
        required: true,
        enum: ['pending','shipped','out for delivery', 'delivered', 'cancelled', 'returnRequested', 'returned','failed'],
        default: 'pending'
    },
    retryCount: {
        type: Number,
        default: 0
    },
    retryLocked: {
        type: Boolean,
        default: false
    },
    deliveredOn: {
        type: Date
    },
    coupenId: {
        type: Schema.Types.ObjectId,
        ref: 'Coupon',
        default: null
    }
    
},{timestamps: true})

const Order = mongoose.model('Order', orderSchema);

export default Order;