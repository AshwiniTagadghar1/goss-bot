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
      prompt: "consent",
    },
  })
);

// let customkeyboard = {
//   keyboard : {
//     Type: 'keyboard',
//     Buttons: [
//       {
//         Action: 'open-url',
//         ActionBody: 'www.google.com',
//         Text: 'Authenticate',
//       }
//     ]
//   }
// }

const client = new ViberClient({
  accessToken: process.env.VIBER_AUTH_TOKEN,
});

app.use(express.json());

app.get("/", async (req, res) => {
  try {
    let msgAuth;
    if (req.oidc.isAuthenticated()) {
      const senderId = req.query.senderId;
      // console.log("senderId:", senderId);
      const expires_in = req.oidc.accessToken.expires_in;
      // console.log(expires_in);

      msgAuth =
        "You have logged in! Please close this tab and proceed to the chatbot!";

      UserAuth.findOne({ viberId: senderId }, (err, foundDoc) => {
        if (err) return console.error(err);
        // console.log(foundDoc);
        if (foundDoc) {
          // if viberId exists, user is re-login, so update token details in DB!
          if (foundDoc.is_expired) {
            // token was expired, so new token expires_in is generated by oidc (assumption), so update both token_expires_in and token_issued_at and set is_expired to false
            UserAuth.findOneAndUpdate(
              { viberId: senderId },
              {
                $set: {
                  token_expires_in: expires_in,
                  token_issued_at: Math.floor(Date.now() / 1000),
                }
              },
              { new: true },
              (err, updatedDoc) => {
                if (err) return console.error(err);
                console.log("Document updated: ", updatedDoc);
              }
            );

            console.log("token updated");
          } else {
            // do nothing
            console.log("token active");
          }
        } else {
          // viberId not present, means new user, so store new user details in DB!

          const newUser = new UserAuth({
            viberId: senderId,
            token_expires_in: expires_in,
            token_issued_at: Math.floor(Date.now() / 1000),
            is_expired: false,
          });

          newUser.save();
          console.log("token created");
        }
      });
    } else {
      msgAuth = "Please login again using login link provide by the chatbot";
    }
  } catch (err) {
    console.log(err);
  }

  res.send(msgAuth);
});

app.get("/login", (req, res) => {
  console.log(req.headers);
  const senderId = req.query.senderId;
  res.oidc.login({
    returnTo: `/?senderId=${senderId}`,
    authorizationParams: {
      redirect_uri: `${NGROK_URL}/callback`,
    },
  });
  console.log(req.headers);
});

app.post("/viber/webhook", async (req, res) => {
  //  console.log('req content is here:', req.body);
  //console.log('res content is here:', req.headers);
  const { event, user, sender,message, user_id } = req.body;
  let viberUserId, viberUserName, authenticationUrl;

  if (event === "conversation_started" || event === "subscribed") {
    try {
      viberUserId = user.id;
      viberUserName = user.name;
      authenticationUrl = `${NGROK_URL}/login?senderId=${viberUserId}`;
      await authHandler(viberUserId, viberUserName, event, message, authenticationUrl);
    } catch (err) {
      console.log(err);
    }
  } else if (event === "message") {
    try {
      viberUserId = sender.id;
      viberUserName = sender.name;
      authenticationUrl = `${NGROK_URL}/login?senderId=${viberUserId}`;
      await authHandler(viberUserId, viberUserName, event, message, authenticationUrl);
    } catch (err) {
      console.log(err);
    }
  } else if (event === "unsubscribed") {
    // Perform some action, such as removing the user from the database
    console.log(user_id, "has unregistered!");
  } else if (req.headers["x-github-event"] === "pull_request") {
    try {
      await handlePullRequestEvent(req.body);
    } catch (err) {
      console.log(err);
    }
  }
  res.sendStatus(200);
});

const authHandler = async (
  viberUserId,
  viberUserName,
  event,
  message,
  authenticationUrl
) => {
  try {
    await UserAuth.findOne({ viberId: viberUserId }, (err, userExist) => {
      if (err) return console.error(err);
      // console.log(foundDoc);
      if (userExist) {
        // validating through token expiry
        const expires_in = userExist.token_expires_in;
        const issued_at = userExist.token_issued_at;
        const expirationTime = expires_in + issued_at; // Expiration time in seconds

        const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds
        const isExpired = currentTime > expirationTime ? true : false; // check for token expiry

        if (isExpired) {
          // user has to reauthenticate, and update user_auth in db!
          UserAuth.findOneAndUpdate({ viberId: viberUserId }, { $set: { is_expired: true }}, { new: true }, (err, updatedDoc) => {
              if (err) return console.error(err);
              console.log("Document updated: ", updatedDoc);
            });

          client.sendText(
            user.id,
            `Hi ${viberUserName}, Please login using this link: ${authenticationUrl} and then type "register" to register your Github repo for pull request notifications! `
            // customkeyboard
          );
        } else {
          // user is still authenticated, user might have unsubscribed, and resubscribed, so can directly tell user to proceed to register his repo!
          if (event === "conversation_started" || event === "subscribed") {
            try {
              client.sendText(
                viberUserId,
                `Welcome back ${viberUserName}! You are already logged in! Please type "register" to register your Github repo for pull request notifications! `
              );
            } catch (err) {
              console.log(err);
            }
          } else if (event === "message") {
            if (message.text.toLowerCase() === "register") {
              try {
                client.sendText(
                  viberUserId,
                  'Please provide your details in the following format: "details GitHub_Access_Token UserName RepoName"'
                );
              } catch (err) {
                console.log(err);
              }
            }
          } else if (message.text.toLowerCase().startsWith("details")) {
            const accessToken = message.text.split(" ")[1];
            const repoOwner = message.text.split(" ")[2];
            const repoName = message.text.split(" ")[3];
            try {
              setGithubWebhook(
                viberUserId,
                viberUserName,
                accessToken,
                repoOwner,
                repoName
              );
            } catch (err) {
              console.log(err);
            }
          } else {
            // echo user
            try {
              client.sendText(
                sender.id,
                `Hello ${sender.name}, you said: ${message.text}`
              );
            } catch (err) {
              console.log(err);
            }
          }
        }
      } else {
        // user not exist so need to authenticated and store in DB
        client.sendText(
          viberUserId,
          `Hi ${viberUserName}, Welcome to our Chatbot! Please login here: ${authenticationUrl} and then type "register" to register your Github repo for pull request notifications! `
          // customkeyboard
        );
      }
    });
  } catch (err) {
    console.log(err);
  }
};

const setGithubWebhook = async (
  userId,
  userName,
  accessToken,
  repoOwner,
  repoName
) => {
  const octokit = new Octokit({ auth: accessToken });
  try {
    const hooks = await octokit.repos.listWebhooks({
      owner: repoOwner,
      repo: repoName,
    });
    const hook = hooks.data.find(
      (h) => h.config.url === `${NGROK_URL}/viber/webhook`
    );
    if (hook) {
      // if same github webhook exists delete it!
      await octokit.repos.deleteWebhook({
        owner: repoOwner,
        repo: repoName,
        hook_id: hook.id,
      });
    }

    // github webhook not same as ngrok_url webhook or github webhook doesn't exist for repo
    const result = await octokit.repos.createWebhook({
      owner: repoOwner,
      repo: repoName,
      name: "web",
      events: ["push", "pull_request"],
      active: true,
      config: {
        url: `${NGROK_URL}/viber/webhook`,
        content_type: "json",
      },
    });

    if (result.status === 201) {
      ViberUser.findOne({ repoOwner: repoOwner }, (err, foundDoc) => {
        if (err) return console.error(err);
        // console.log(foundDoc);
        if (foundDoc) {
          // if repo exists, user details already exist in DB, so no need of storing it again!
          if (foundDoc.repos.includes(repoName)) {
            client.sendText(userId, `Repo: ${repoName} is already registered!`);
          } else {
            // user registering new repo, so update the user's repos list
            ViberUser.findOneAndUpdate(
              { repoOwner: repoOwner },
              { $push: { repos: repoName } },
              { new: true },
              (err, foundDoc) => {
                if (err) return console.error(err);
                console.log("Document updated: ", foundDoc);
              }
            );
          }
        } else {
          //  this means user doesnt not exist, so create new user and store in DB!
          // for new user registration
          const registeredUser = new ViberUser({
            viberId: userId,
            viberUserName: userName,
            githubToken: accessToken,
            repoOwner,
            repos: [repoName],
          });

          registeredUser.save();
          client.sendText(
            userId,
            `You have successfully registered your repo: ${repoName} for pull request notifications!`
          );
        }
      });
    }
  } catch (err) {
    // error gets triggered when a invalid creds are provided or webhook url already exists for the repoOwner
    await client.sendText(
      userId,
      `Invalid credentials! Check you token validity as well as credentials!`
    );
  }
};

const handlePullRequestEvent = async (pullRequestEvent) => {
  try {
    const { action, pull_request } = pullRequestEvent;
    const pullRequestOwner = pull_request.user.login; // owner of the pull request
    const repositoryName = pull_request.base.repo.name; // name of the repo
    const repositoryURL = pull_request.base.repo.html_url; // repo ka url
    const repoOwner = pull_request.base.user.login; // owner of the repo

    await ViberUser.findOne({ repoOwner: repoOwner }, (err, foundDoc) => {
      if (err) return console.error(err);
      if (foundDoc) {
        const userId = foundDoc.viberId;
        let message;
        if (action === "opened") {
          message = `A new pull request has been opened in the repository ${repositoryName} by the user: ${pullRequestOwner}. Here's the repo link: ${repositoryURL}`;
        } else if (action === "closed") {
          message = `A pull request in the repository ${repositoryName} by the user: ${pullRequestOwner}. (${repositoryURL}) has been closed.`;
        } else if (action === "reopened") {
          message = `A pull request in the repository ${repositoryName} by the user: ${pullRequestOwner}. (${repositoryURL}) has been reopened.`;
        }
        client.sendText(userId, message);
      }
    });
  } catch (err) {
    console.error(err);
  }
};

try {
  client.setWebhook(`${NGROK_URL}/viber/webhook`);
  console.log("webhook set successfully!");
} catch (err) {
  console.log("unable to set webhook:", err);
}

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
