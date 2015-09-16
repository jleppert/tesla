var template = require('./templates/index.dust');

function Map(app, id, view) {
  app.route('/', this.render);
  
  this.context.id = id;
  this.context.view = view;
}

Map.prototype.doSomething = function() {
  console.log("called do something!");
};

Map.prototype.context = {
 name: 'map',
 action: 'doSomething'
};

Map.prototype.render = function(chunk, context, bodies, params) {
  return chunk.map(function(inner_chunk) {
    template(this.context, function(err, out) {
      inner_chunk.write(out).end();
    });
  }.bind(this));
}

module.exports = Map;
