const mongoose = require('mongoose');

const Schema = mongoose.Schema;
const viberUserSchema = new Schema({
    viberUserName: {type: String, required: true},
    viberId: {type: String, required: true},
    githubToken: {type: String, required: true},
    repoOwner: {type: String, required: true},
    repos: [{ type: String, required: true }]
   });

module.exports = mongoose.model('ViberUser', viberUserSchema);