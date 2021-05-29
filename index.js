// Get User Tweet timeline by user ID
// https://developer.twitter.com/en/docs/twitter-api/tweets/timelines/quick-start

const needle = require('needle');
const sqlite3 = require('sqlite3');

// this is the ID for @redmed666
// from https://tweeterid.com/
const userId = "902602066887151617";
const userTweetsApi = `https://api.twitter.com/2/users/${userId}/tweets`;

// The code below sets the bearer token from your environment variables
// To set environment variables on macOS or Linux, run the export command below from the terminal:
// export BEARER_TOKEN='YOUR-TOKEN'
const bearerToken = process.env.BEARER_TOKEN;
const maxResults = 100;
const tags = ["XSS", "Recon", "Infosec", "IDA", "Ghidra", "Reverse", "Javascript", "Exploitation", "Binary", "CVE", "ARM", "Qemu", "Hack", "Malware", "Bug", "FPGA", "Forensics", "CTF", "Pentest", "Penetration", "iOS", "MacOS", "Python", "Windows", "Linux", "Hunt", "C++", "Golang", "Rust", "Mimikatz", "GIT", "Book", "Machine Learning", "LSASS", "Protection", "Bypass", "Dump", "Pass-The-Hash", "Kerberos", "VBA", "VX-Underground", "Tool", "Lazarus", "APT29", "Turla", "APT28", "Web App", "Race Condition", "Tuto", "Browser", "Backdoor", "Docker", "DevOps", "Nuclei", "Collection"]

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const getUserRetweets = async () => {
  let userTweets = [];

  // we request the author_id expansion so that we can print out the user name later
  let params = {
    "max_results": maxResults,
    "tweet.fields": "created_at,text,entities,referenced_tweets",
    "expansions": "author_id,referenced_tweets.id.author_id"
  }

  const options = {
    headers: {
      "User-Agent": "v2UserTweetsJS",
      "authorization": `Bearer ${bearerToken}`
    }
  }

  let hasNextPage = true;
  let nextToken = null;
  let userName;

  while (hasNextPage) {
    let resp = await getPage(params, options, nextToken);
    if (resp && resp.meta && resp.meta.result_count && resp.meta.result_count > 0) {
      userName = resp.includes.users[0].username;
      // because we are interested in retweets, we need to take a look at resp.includes.tweets field instead of resp.data
      if (resp.data && resp.includes.tweets) {
        userTweets.push.apply(userTweets, resp.includes.tweets);
      }
      if (resp.meta.next_token) {
        nextToken = resp.meta.next_token;
      } else {
        hasNextPage = false;
      }
    } else {
      hasNextPage = false;
    }
  }

  console.log(`\t[*]Got ${userTweets.length} Tweets from ${userName} (user ID ${userId})!`);

  return userTweets;
}

const getPage = async (params, options, nextToken) => {
  if (nextToken) {
    params.pagination_token = nextToken;
  }

  try {
    const resp = await needle('get', userTweetsApi, params, options);

    if (resp.statusCode != 200) {
      console.log(`${resp.statusCode} ${resp.statusMessage}:\n${resp.body}`);
      return;
    }
    return resp.body;
  } catch (err) {
    throw new Error(`Request failed: ${err}`);
  }
}

const getRTFromTweets = async (tweets) => {
  let retweets = [];

  tweets.forEach(tw => {
    if (tw.text.startsWith("RT @")) {
      retweets.push(tw);
    }
  });

  return retweets;
}

const createDB = async () => {
  let db = new sqlite3.Database('./db/twitter.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('\t[*]Connected to the twitter database.');
  });

  return db;
}

const createTable = async (db) => {
  db.serialize(() => {
    // Queries scheduled here will be serialized.
    db.run('CREATE TABLE IF NOT EXISTS retweets(id INTEGER PRIMARY KEY, message TEXT, created_at DATETIME, author_id TEXT, username TEXT, urls TEXT, tags TEXT)');
  });
}

const getUsernameFromID = async (id) => {
  try {
    let params = {
      "user.fields": "name",
    }

    const options = {
      headers: {
        "User-Agent": "v2UserTweetsJS",
        "authorization": `Bearer ${bearerToken}`
      }
    }

    const userApiUrl = `https://api.twitter.com/2/users/${id}`;

    const resp = await needle('get', userApiUrl, params, options);

    if (resp.statusCode != 200) {
      console.log(`${resp.statusCode} ${resp.statusMessage}:\n${resp.body}`);
      return;
    }
    return resp.body.data.username;
  } catch (err) {
    throw new Error(`Request failed: ${err}`);
  }
}

const getTagsFromText = (text) => {
  let tagsFound = "";
  const textLower = text.toLowerCase();
  tags.forEach(tag => {
    if (textLower.includes(tag.toLowerCase())) {
      tagsFound = tagsFound.concat(tag, ",");
    }
  });

  return tagsFound;
}

const checkIfIdExists = async (db, id) => {
  let sql = `select exists(select 1 from retweets where id=?) limit 1`;
  const res = db.all(sql, [id], (err, row) => {
    if (err) {
      return console.log(err.message);
    }
    return row;
  });
  return res;
}

const insertRTInDB = async (db, retweet) => {
  // use a lot of API calls
  const idPresent = await checkIfIdExists(db, retweet.id);
  console.log("IDPRESENT");
  console.log(idPresent);
  if (idPresent === 1) {
    console.log("Already there");
    return;
  }
  const username = await getUsernameFromID(retweet.author_id);
  //const username = retweet.author_id;

  let urls = "";
  if (retweet.entities) {
    if (retweet.entities.urls) {
      if (retweet.entities.urls instanceof Array) {
        retweet.entities.urls.forEach(url => {
          urls = urls.concat(url.expanded_url);
          urls = urls.concat(",")
        });
      } else {
        urls = urls.concat(retweet.entities.urls.expanded_url);
        urls = urls.concat(",")
      }
    }
  }

  const tagsFound = await getTagsFromText(retweet.text);


  db.run(`INSERT INTO retweets(id, message, created_at, author_id, username, urls, tags) VALUES(?, ?, ?, ?, ?, ?, ?)`, [retweet.id, retweet.text, retweet.created_at, retweet.author_id, username, urls, tagsFound], function (err) {
    if (err) {
      return console.log(err.message);
    }
  });
}

const main = async () => {

  console.log("[*] Retrieving tweets");
  const userRetweets = await getUserRetweets();
  //console.dir(userTweets);
  //console.log("[*] Get RT from tweets");
  //const userRetweets = await getRTFromTweets(userTweets);
  //console.dir(userRetweets);
  console.log("[*] Create DB");
  let db = await createDB();
  console.log("[*] Create table");
  await createTable(db);
  console.log("[*] Inserting tweets in table");
  for (const rt of userRetweets) {
    await insertRTInDB(db, rt);
    await sleep(2000);
  };

  db.close();

}

main();