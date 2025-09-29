const mongoose = require('mongoose');
const {Schema} = mongoose;

const userSchema = new Schema({
    name: {
        type: String,
        // required: true
    },
   password: {
    type: String,
    required: true
   },
   email: {
    type: String,
    required: true,
    unique: true

   },
   mobileNumber: {
    type: Number,
    required: false
   },
    createdAt:{
        type:Date,
        default:Date.now
    },
     updatedAt:{
        type:Date,
        default:Date.now
    }, 
    isBlocked:{
        type:Boolean,
        default:false
    },
    isAdmin:{
        type:Boolean,
        default:false
    }, 
     refferalcode:{
        type:String,
    },
    refferedBy:{
        type:Boolean
    },
    redeemedUsers:[{
        // type:Schema.Types.ObjectId,
        // ref:'User'
    }],
    googleId:{
        type:String,
        unique:true,
    },
    cart:[{
        type:Schema.Types.ObjectId,
        ref:'Cart'
    }],
    wallet: {
        type: Number,
        default: 0
    },
    wishlist:[{
        type:Schema.Types.ObjectId,
        ref:'Wishlist'
    }],
    orderdetails:[{
        type:Schema.Types.ObjectId,
        ref:'Order'
    }],
    orderHistory:[{
        type:Schema.Types.ObjectId,
        ref:'Order'
    }],
    searchHistory:[{
        category:{
            type:Schema.Types.ObjectId,
            ref:'Category'
        },
        searchOn:{
            type:Date,
            default:Date.now
        }
    }]
})

const User = mongoose.model("user", userSchema);

module.exports = User;