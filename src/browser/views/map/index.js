var template = require('./templates/index.dust');

function Map(app, id, view) {
  app.route('/', this.render);
  
  this.context.id = id;
  this.context.view = view;
}

Map.prototype.submit = function() {
  console.log("called submit!");
};

Map.prototype.context = {
 name: 'map',
 action: 'doSomething'
};

Map.prototype.render = function(chunk, context, bodies, params) {
  return chunk.map(function(inner_chunk) {
    template(this.context, function(err, out) {
      // replace event handlers with unique component id to later attach event handlers after dom diff has completed
      // figure out how to re-bind event if the dom has changed
      // data-ev="componentId:event:prop"
      // goes through dom and binds/unbinds events on dom patches
      inner_chunk.write(out).end();
    });
  }.bind(this));
}

module.exports = Map;
