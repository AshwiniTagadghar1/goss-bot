require("dotenv").config();
const { ViberClient } = require("messaging-api-viber");
const express = require("express");
const { Octokit } = require("@octokit/rest");
const mongoose = require("mongoose");
const ViberUser = require("./models/viber_user");
const UserAuth = require("./models/user_auth");
const { auth } = require("express-openid-connect");

mongoose.set("strictQuery", false);

const app = express();

const NGROK_URL = process.env.NGROK_URL;
const MONGO_URL = process.env.MONGO_URL;

// Set up authentication middleware
app.use(
  auth({
    authRequired: false,
    idpLogout: true,
    auth0Logout: true,
    issuerBaseURL: process.env.ISSUER_BASE_URL,
    clientID: process.env.CLIENT_ID,
    secret: process.env.CLIENT_SECRET,
    baseURL: NGROK_URL,
    routes: {
      login: false,
      // callback: '/callback'
    },
    authorizationParams: {
      response_type: "code",
      // prompt: "consent",
    },
  })
);


const client = new ViberClient({
  accessToken: process.env.VIBER_AUTH_TOKEN,
});

app.use(express.json());





app.post("/viber/webhook", async (req, res) => {

  const { event, user, sender, message, user_id } = req.body;
  let viberUserId, viberUserName, authenticationUrl, encodedId;

  if (event === "conversation_started" || event === "subscribed") {
    try {
      //viberUserId = user.id;
      //viberUserName = user.name;
      await client.sendText(
        user.id,
        `Welcome ${user.name} to the bot`
        // customkeyboard
      );
    
    } catch (err) {
      console.log('err from conv start or sub: ', err);
    }
  } else if (event === "message") {
    try {
      //viberUserId = sender.id;
      //viberUserName = sender.name;
      
      await client.sendText(
        sender.id,
        `You typed: ${message.text}`
        // customkeyboard
      );
      
    } catch (err) {
      console.log('err from msg: ', err);
    }
  } else if (event === "unsubscribed") {
    // Perform some action, such as removing the user from the database
    console.log(user_id, "has unregistered!");
  } 
  res.sendStatus(200);
});
const port = process.env.PORT || 3001;

mongoose
  .connect(MONGO_URL)
  .then(() => {
    app.listen(port, () => {
      console.log(`Listening on port: ${port}`);
    });
  })
  .catch((err) => {
    console.log(err);
  });
