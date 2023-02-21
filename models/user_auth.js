const mongoose = require("mongoose");

const Schema = mongoose.Schema;
const userAuthSchema = new Schema({
    viberId: { type: String, required: true }, // ID of the user or client associated with the access token
    // access_token: { type: String, required: true }, // Access token value
    token_expires_in: { type: Number, required: true }, // Lifetime of the access token in seconds
    // token_type: { type: String, required: true }, // Type of the access token (e.g., "Bearer")
    // refresh_token: { type: String, required: true }, // Refresh token value (if applicable)
    token_issued_at: { type: Number, required: true }, // Time when the access token was issued, in seconds since the Unix epoch
    is_expired: {type: Boolean, required: true } // to know if token is expired
});

module.exports = mongoose.model("UserAuth", userAuthSchema);
