var express = require('express'),
    config  = require('../../etc/config'),
    path    = require('path');

function Tesla() {
  var app = express();
  app.use(express.static(path.join(__dirname, '../../var/build')));

  this.app = app;
  this.config = config;
}

Tesla.prototype.start = function() {
  this.app.listen(config.port);
}

module.exports = Tesla;
