// import libraries
var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var port = process.env.PORT || 3000;

const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

var Filter = require('bad-words-plus'),
  filter = new Filter({ firstLetter: true });
const anchorme = require("anchorme").default;

// create usernames object
var usernames = {};

// send data to user
app.use(express.static(__dirname + '/public'));

// socket.io connection
io.on('connection', function(socket) {
  var username;
  var room = 'main';
  socket.muted = 0;
  socket.admin = 0;
  socket.banned = 0;
  socket.vc = 0;

  socket.on('adduser', function(user, admin,vcid,fn2) {
    // hacky thing for banned users
    if (admin == 'banned') {
      socket.banned = 1;
      username = user;
      usernames[username] = socket;
      room = 'ban';
      socket.join('ban');
      socket.emit('serverChat', '{SERVER} You are in purgatory. (room: "' + room + '")');
      socket.broadcast.in(room).emit('serverChat', '{SERVER} ' + username + ' joined the club.');
      return;
    }
    if (admin) {
      socket.admin = 1;
    }
    try {
      user = filter.clean(user);
    } catch { }
    if (user in usernames && !socket.admin) {
      fn2(true);
      return;
    }
    // when user submits a valid username
    fn2(false);
    socket.vc = vcid;
    username = user;
    usernames[username] = socket;
    socket.join(room);
    socket.emit('serverChat', '{SERVER} You have connected to Room ' + room + '!');
    socket.broadcast.emit('serverChat', '{SERVER} ' + username + ' has connected to the chatroom!');
    io.emit('playSound', 'sn1');
    console.log(username + ' has joined!');
  });
  socket.on('nameChange', function(user, fn3) {
    try {
      user = filter.clean(user);
    } catch { }
    let oldUser = username;
    if (oldUser == user) {
      fn3('e');
    } else if (user in usernames) {
      fn3(true);
      return;
    }
    // when user submits a valid username
    fn3(false);
    oldUser = username;
    username = user;
    delete usernames[oldUser];
    usernames[username] = socket;
    socket.emit('serverChat', '{SERVER} You changed your username to ' + username);
    socket.broadcast.emit('serverChat', '{SERVER} ' + oldUser + ' changed their username to ' + username);
    console.log(oldUser + ' changed their name to ' + username);
  });
  socket.on('switchRoom', function(newroom) {
    if (socket.banned) {
      return;
    }
    if (room == newroom) {
      socket.emit('serverChat', 'You are already in Room ' + newroom + '.');
    } else {
      // when user witches room
      socket.leave(room);
      socket.join(newroom);
      socket.emit('serverChat', '{SERVER} You have connected to Room ' + newroom + '!');
      socket.broadcast.to(room).emit('serverChat', '{SERVER} ' + username + ' has left this room.');
      room = newroom;
      console.log(username+' joined '+newroom);
      io.emit('notTyping',username);
      socket.broadcast.to(newroom).emit('serverChat', '{SERVER} ' + username + ' has joined this room.');
    }
  });
  socket.on('chat message', function(msg, img) {
    if (socket.muted) {
      socket.emit('mute');
      return;
    }
    if (msg.includes('nig')) {
      socket.emit('serverChat','no lol');
      return;
    }
    // when user sends message
    try {
      msg = anchorme({input:msg,options:{attributes:{target:"_blank"},specialTransform:[{test:/.*\.(png|jpg|gif)$/,transform:s=>`<img src="${s.startsWith("http")?s:`http://${s}`}" class="chat-img">`},{test:/youtube\.com\/watch\?v\=/,transform:t=>`<iframe src="https://www.youtube.com/embed/${t.replace(/.*watch\?v\=(.*)$/,"$1").split('&')[0]}" class="chat-video"></iframe>`}]}});
      msg = filter.clean(msg);
      msg = notifyMentions(msg);
    } catch (e) {}
    io.in(room).emit('chat message', msg, 'black',img);
    console.log(msg);
  });
  socket.on('admin message', function(msg, color, img) {
    if (!socket.admin) {
      socket.emit('serverChat', 'Nice try.');
      return;
    }
    try {
      msg = anchorme({input:msg,options:{attributes:{target:"_blank"},specialTransform:[{test:/.*\.(png|jpg|gif)$/,transform:t=>`<img src="${s.startsWith("http")?s:`http://${s}`}" class="chat-img">`},{test:/youtube\.com\/watch\?v\=/,transform:t=>`<iframe src="https://www.youtube.com/embed/${t.replace(/.*watch\?v\=(.*)$/,"$1").split('&')[0]}" class="chat-video"></iframe>`}]}});
      msg = notifyMentions(msg);
    } catch (e) {}
    io.in(room).emit('chat message', msg, color,img);
    console.log(msg);
  });
  socket.on('disconnect', (reason) => {
    if (username) {
      // when user disconnects
      console.log(username + ' has disconnected because of ' + reason);
      io.emit('serverChat', '{SERVER} ' + username + ' has lost connection.');
      delete usernames[username];
      io.emit('playSound', 'sn2');
      io.emit('notTyping',username);
    }
  });
  socket.on('reqClear', function() {
    if (!socket.admin) {
      socket.emit('serverChat', 'Nice try.');
      return;
    }
    // deletes all visual message elements
    io.in(room).emit('sendClear');
    console.log(username+' cleared the chat');
  });
  socket.on('reqUserlist', function(tb) {
    // sends user an array of all online users
    if (tb) {
      socket.emit('userlist',Object.keys(usernames));
    } else {
      userlist = Object.keys(usernames).toString().split(',').join(', ');
      socket.emit('serverChat', '{SERVER} Userlist: ' + userlist);
    }
  });
  socket.on('reqMute', function(user) {
    if (!socket.admin) {
      socket.emit('serverChat', 'Nice try.');
      return;
    }
    // mute a user
    user = user.replace('_', ' ');
    if (user == 'all') {
      io.emit('mute');
      socket.emit('serverChat', '{SERVER} Successfully muted all users.');
    } else if (user in usernames) {
      io.to(usernames[user].id).emit('mute',username);
      usernames[user].muted = 1;
      io.to(room).emit('serverChat', '{SERVER} ' + user + ' was muted.');
      console.log(username+' muted '+user);
    } else {
      socket.emit('serverToast', 'No user has the name ' + user + '.');
    }
  });
  socket.on('reqUnmute', function(user) {
    if (!socket.admin) {
      socket.emit('serverChat', 'Nice try.');
      return;
    }
    // unmute a user
    user = user.replace('_', ' ');
    if (user == 'all') {
      io.in(room).emit('unmute');
      socket.emit('serverChat', '{SERVER} Successfully unmuted all users');
    } else if (user in usernames) {
      io.to(usernames[user].id).emit('unmute',username);
      usernames[user].muted = 0;
      io.to(room).emit('serverChat', '{SERVER} ' + user + ' was unmuted.');
      console.log(username+' unmuted '+user);
    } else {
      socket.emit('serverToast', 'No user has the name ' + user + '.');
    }
  });
  socket.on('reqBan', function(user) {
    if (!socket.admin) {
      socket.emit('serverChat', 'Nice try.');
      return;
    }
    // ban a user
    user = user.replace('_', ' ');
    if (user in usernames) {
      io.to(usernames[user].id).emit('ban', username);
      io.to(room).emit('serverChat', '{SERVER} ' + user + ' was banned.');
      console.log(username+' banned '+user);
    } else {
      socket.emit('serverToast', 'No user has the name ' + user + '.');
    }
  });
  // unban a user
  socket.on('reqUnban', function(user) {
    if (!socket.admin) {
      socket.emit('serverChat', 'Nice try.');
      return;
    }
    user = user.replace('_', ' ');
    if (user in usernames) {
      io.to(usernames[user].id).emit('unban', username);
      io.to(room).emit('serverChat', '{SERVER} ' + user + ' was unbanned.');
      console.log(username+' unbanned '+user);
    } else {
      socket.emit('serverToast', 'No user has the name ' + user + '.');
    }
  });
  socket.on('reqWarn', function(user,reason) {
    if (socket.banned || !(socket.admin || socket.wl)) {
      socket.emit('serverChat', 'Nice try.');
      return;
    }
    // warn a user
    user = user.replace('_', ' ');
    if (user in usernames) {
      io.to(usernames[user].id).emit('warn', username,reason);
      console.log(username+' warned '+user);
    } else {
      socket.emit('serverToast', 'No user has the name ' + user + '.');
    }
  });
  socket.on('pm', function(user, msg, img) {
    user = user.replace('_', ' ');
    if (user in usernames) {
      try {
        msg = anchorme({input:msg,options:{attributes:{target:"_blank"},specialTransform:[{test:/.*\.(png|jpg|gif)$/,transform:s=>`<img src="${s.startsWith("http")?s:`http://${s}`}" class="chat-img">`},{test:/youtube\.com\/watch\?v\=/,transform:t=>`<iframe src="https://www.youtube.com/embed/${t.replace(/.*watch\?v\=(.*)$/,"$1").split('&')[0]}" class="chat-video"></iframe>`}]}});
        msg = notifyMentions(msg);
        if (!socket.admin) msg = filter.clean(msg);
      } catch (e) {}
      io.to(usernames[user].id).emit('chat message', '{PRIVATE MESSAGE} ' + username + ' : ' + msg, '#49796b', img);
      io.to(usernames[user].id).emit('playSound', 'n1');
      socket.emit('chat message', '{PRIVATE MESSAGE} to ' + user + ' : ' + msg, '#49796b', img);
      console.log(username+' private messaged '+user);
    } else {
      socket.emit('serverToast', 'No user has the name ' + user + '.');
    }
  });
  socket.on('vc', function(user) {
    // when user requests voicechat, send vocechat data from requested user
    user = user.replace('_', ' ');
    if (user in usernames) {
      socket.emit('vc',usernames[user].vc,user);
      console.log(username+' sent vc request to '+user);
    } else {
      socket.emit('serverToast', 'No user has the name ' + user + '.');
    }
  });
  socket.on('whitelist', function(user) {
    // whitelist user (extra priviledges)
    user = user.replace('_', ' ');
    if (user in usernames) {
      io.to(usernames[user].id).emit('whitelisted',username);
      usernames[user].wl = 1;
      socket.emit('serverChat', '{SERVER}: Successfully whitelisted ' + user + '.');
      console.log(username+' whitelisted '+user);
    } else {
      socket.emit('serverToast', 'No user has the name ' + user + '.');
    }
  });
  socket.on('announce', function(msg) {
    if (!socket.admin) {
      socket.emit('serverChat', 'Nice try.');
      return;
    }
    // announce message to every user, no matter what room they're in
    io.emit('announcement', username, msg);
    console.log(username+' announced'+ msg);
  });
  socket.on('reqUpdate', function() {
    if (!socket.admin) {
      socket.emit('serverChat', 'Nice try.');
      return;
    }
    // updates clients
    io.emit('sendUpdate');
    console.log(username+' requested an update');
  });
  socket.on('typing', function() {
    // announce when a user is typing
    socket.broadcast.in(room).emit('typing', username);
  });
  socket.on('notTyping', function() {
    // announce when user stops typing
    socket.broadcast.in(room).emit('notTyping', username);
  });
  socket.on('reconnect',function(user,admin,vcid) {
    if (user) {
      if (admin) {
        socket.admin = 1;
      }
    try {
      user = filter.clean(user);
      rmvTag = user.split('] ')[1];
        if (rmvTag) {
          user = rmvTag;
      }
    } catch {}
    // reconnect user if they disconnected from an error
    socket.vc = vcid;
    username = user;
    usernames[username] = socket;
    socket.join(room);
    console.log(username + ' has reconnected!');
    socket.broadcast.emit('serverChat', '{SERVER} ' + username + ' has reconnected.');
    socket.emit('serverToast','You have reconnected!');
    }
  });
  function notifyMentions(msg) {
    if (msg.includes('@')) {
      mentions = msg.split(' ').filter(/./.test, /@/);
      // when a user @mentions another valid user, send a notification
      var usernamesLC = Object.fromEntries(Object.entries(usernames).map(([k, v]) => [k.toLowerCase(), v]));

      mentions.forEach(function(mention) {
        mention = mention.replace('@', '').replace('_', ' ').toLowerCase();

        if (mention == 'all') {
          io.emit('mention',username);
          console.log(username+' mentioned everyone');
          msg = msg.replace(`@${mention}`, `<a class="mention">@${mention}</a>`);
        } else if (mention in usernamesLC) {
          io.to(usernamesLC[mention].id).emit('mention',username);
          console.log(username+' mentioned '+mention);

          var mentionLC = new RegExp("@" + mention, "ig");
          console.log(mentionLC)
          msg = msg.replace(mentionLC, `<a class="mention">$&</a>`);
        }
      });
    }
    return msg;
  }
  socket.on('dec',function(user){try{io.to(usernames[user].id).emit('dec');}catch{}}); // announce voicechat declination
  socket.on('hangup', function(user){try{io.to(usernames[user].id).emit('hungup');}catch{}}); // announce voicechat hangup
  socket.on('ping',function(fn){fn();}); // get ping
  socket.on('du',function(){
    // if user wants to change username or something
    delete usernames[username];
    socket.admin = 0;
  });
});

http.listen(port, function() {
  console.log('listening on *:' + port + '\nchat logs:');
  serverChat();
});

function serverChat() {
  // allow owner to send messages as the server if a message is sent through console
  rl.question('', (answer) => {
    if (answer) {
      msg = answer;
      io.emit('serverChat', `{SERVER} ` + msg);
      console.log(msg);
    }
    serverChat();
  });
}