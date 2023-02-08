require('dotenv').config();
const { ViberClient } = require('messaging-api-viber');
const express = require('express');
const { Octokit } = require("@octokit/rest");
const mongoose = require('mongoose');
const ViberUser = require('./models/viber_user');

// mongoose.set('strictQuery', true);

const app = express();

const NGROK_URL = process.env.NGROK_URL;
const MONGO_URL = process.env.MONGO_URL;


const client = new ViberClient({
  accessToken: process.env.VIBER_AUTH_TOKEN
});

app.use(express.json());

app.post('/viber/webhook', async (req, res) => {
  //  console.log('req content is here:', req.body);
    // console.log('res content is here:', res);
  const { event , user, sender , message } = req.body;
//   console.log(user_id);

// this event gets triggered when a new user has just opened chat link
  if (event === 'conversation_started') { 
    await client.sendText( user.id, `Hello ${user.name}, Welcome to our ChatBot! Please type "register" to register your repo details` );
  }

// this event gets triggered when a new user has just opened chat link and sends message,
//  automatically subscribed but subscribe event is not triggered! or any subscribed user sends a message
  else if (event === 'message') { 

      if (message.text.toLowerCase() === 'register') {
      await client.sendText(sender.id, 'Please provide your details in the following format: "details GitHub_Access_Token UserName RepoName"');
    } else if (message.text.toLowerCase().startsWith('details')) {
      
        const accessToken = message.text.split(' ')[1];
        const repoOwner = message.text.split(' ')[2];
        const repoName = message.text.split(' ')[3];      
        setGithubWebhook(sender.id, sender.name, accessToken, repoOwner, repoName);  
    
    } else
      client.sendText( sender.id, `Hello ${sender.name}, you said: ${message.text}` );
}

// this event gets triggered when a new user has just opened chat link and clicked on receive messages,
//  without sending any message to the bot
  else if (event === 'subscribed') {  
    await client.sendText(user.id, `Hi ${user.name}, Thanks for subscribing to our chatbot!`);
  } 

// this event gets triggered when a user unsubscribes from the bot
  else if (event === 'unsubscribed') {
    // Perform some action, such as removing the user from the database

  }
  else if (req.headers['x-github-event'] === 'pull_request') {   
    handlePullRequestEvent(req.body);
 }

  res.sendStatus(200);
});

const setGithubWebhook = async (userId, userName, accessToken, repoOwner, repoName) => {
  const octokit = new Octokit({ auth: accessToken });
  try{
  const result = await octokit.repos.createWebhook({
    owner: repoOwner,
    repo: repoName,
    name: 'web',
    events: ['push', 'pull_request'],
    active: true,
    config: {
      url: `${NGROK_URL}/viber/webhook`,
      content_type: 'json'
    }
  });
  if (result.status === 201) {

    const registeredUser = new ViberUser({
      viberId: userId ,
      viberUserName: userName,      
      githubToken: accessToken,
      repoOwner, 
      repos: [repoName]
    });

    try{
      await registeredUser.save();
      await client.sendText(userId, `Webhook for repository ${repoName} has been successfully set.`);   
    } catch (err){
      console.log(err);
    }

     
  }
} catch(err){   
    // error gets triggered when a invalid creds are provided or webhook url already exists for the repoOwner
    await client.sendText(userId, `Invalid credentials! Check you token validity, or your repo for pre-existing repo webhook`);
  };  
};


const handlePullRequestEvent = async (pullRequestEvent) => {
    const { action, pull_request } = pullRequestEvent;
    const pullRequestOwner = pull_request.user.login; // owner of the pull request
    const repositoryName = pull_request.base.repo.name; // name of the repo
    const repositoryURL = pull_request.base.repo.html_url; // repo ka url
    const repoOwner = pull_request.base.user.login; // owner of the repo
    const repoName = pull_request.base.repo.name; // repo name      
    
    try {
      // const userId = userProfile.id;
      const getUserId = await ViberUser.findOne({repoOwner: repoOwner}).select({ "viberId": 1, "_id": 0});
      const userId = getUserId['viberId'];
      
      if (userId) {
        let message;
        if (action === 'opened') {
          message = `A new pull request has been opened in the repository ${repositoryName} by the user: ${pullRequestOwner}. Here's the repo link: ${repositoryURL}`;
        } else if (action === 'closed') {
          message = `A pull request in the repository ${repositoryName} by the user: ${pullRequestOwner}. (${repositoryURL}) has been closed.`;
        } else if (action === 'reopened') {
          message = `A pull request in the repository ${repositoryName} by the user: ${pullRequestOwner}. (${repositoryURL}) has been reopened.`;
        }
  
        client.sendText(userId, message);
      }
    } catch (error) {
      console.error(error);
    }
  };


app.post('/set-webhook', async (req, res) => {
  try {
    const webhookResponse = await client.setWebhook(`${NGROK_URL}/viber/webhook`);
    console.log(webhookResponse);
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});

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
