require('dotenv').config();
const { ViberClient } = require('messaging-api-viber');
const express = require('express');
const { Octokit } = require("@octokit/rest");
const mongoose = require('mongoose');
const ViberUser = require('./models/viber_user');
const { auth, requiresAuth } = require('express-openid-connect');
const session = require('express-session');
mongoose.set('strictQuery', false);

let isAuth = false;
const app = express();

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

const NGROK_URL = process.env.NGROK_URL;
const MONGO_URL = process.env.MONGO_URL;

// Set up authentication middleware
app.use(auth({
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
    response_type: 'code',
    prompt: 'consent'
  }  
}));


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
  accessToken: process.env.VIBER_AUTH_TOKEN
});

app.use(express.json());

app.get("/", async (req, res) => {
  const senderId = req.query.senderId;  
  console.log('senderId:', senderId);
  try{  const val =  req.oidc.accessToken.isExpired();
    console.log(val);
  } catch(err){
    console.log(err);
  }

  isAuth = req.oidc.isAuthenticated()? true: false;
  res.send(isAuth);     
});


app.get('/login', (req, res) => {
  const senderId = req.query.senderId;
  res.oidc.login({
    returnTo: `/?senderId=${senderId}`,
    authorizationParams: {
      redirect_uri: `${NGROK_URL}/callback`,
    },
  })}
);

app.post("/viber/webhook", async (req, res) => {
  //  console.log('req content is here:', req.body);
//   console.log('res content is here:', req.headers);
  const { event, user, sender, message, user_id } = req.body;

  // this event gets triggered when a new user has just opened chat link or click on 'receive message' on 3 dots menu in chat
  if (event === 'conversation_started' || event === "subscribed") {
    const authenticationUrl = `${NGROK_URL}/login?senderId=${user.id}`;
 
    try {
      await client.sendText(
        user.id,
        `Hi ${user.name}, Welcome to our ChatBot! Please login using this link: ${authenticationUrl} and then type "register" to register your Github repo for pull request notifications! `,
        // customkeyboard
      );
    } catch (err) {
      console.log(err);
    }
  }

  // this event gets triggered when a new user has just opened chat link and sends message,
  //  automatically subscribed but subscribe event is not triggered! or any subscribed user sends a message
  else if (event === "message") {
    if (message.text.toLowerCase() === "register") {
      if(isAuth){
         try {
        await client.sendText(
          sender.id,
          'Please provide your details in the following format: "details GitHub_Access_Token UserName RepoName"'
        );
      } catch (err) {
        console.log(err);
      }
      } else {        
        try {
          await client.sendText(
            sender.id,
            `Please login first and then type "register" to register your Github repo for pull request notifications!`
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
        await setGithubWebhook(
          sender.id,
          sender.name,
          accessToken,
          repoOwner,
          repoName
        );
      } catch (err) {
        console.log(err);
      }
    } else {
      try {
        await client.sendText(
          sender.id,
          `Hello ${sender.name}, you said: ${message.text}`);
      } catch (err) {
        console.log(err);
      }
    }
  }  // this event gets triggered when a user unsubscribes from the bot
  else if (event === "unsubscribed") {
    // Perform some action, such as removing the user from the database
    console.log(user_id, 'has unregistered!');

  } else if (req.headers["x-github-event"] === "pull_request") {
    try {
      await handlePullRequestEvent(req.body);
    } catch (err) {
      console.log(err);
    }
  }
  res.sendStatus(200);
});


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
        hook_id: hook.id
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
  console.log('webhook set successfully!');
} catch (err) {
  console.log('unable to set webhook:', err);
}


// try {
//   client.setWebhook(`${NGROK_URL}/unsubngit`);
//   console.log('webhook set successfully!');
// } catch (err) {
//   console.log('unable to set webhook:', err);
// }

mongoose
  .connect(MONGO_URL)
  .then(() => {
    app.listen(3000, () => {
      console.log('Listening on port 3000');
    });
  })
  .catch((err) => {
    console.log(err);
  });

