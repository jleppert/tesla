var page       = require('page'),
    views      = require('./views'),
    dust       = require('dustjs-linkedin'),
    diff       = require('virtual-dom/diff'),
    patch      = require('virtual-dom/patch'),
    tovdom     = require('to-virtual-dom'),
    createElement = require('virtual-dom/create-element'),
    O          = require('observed');


function Tesla() { 
  this.router = page;
  this.views = {};
  
  window.tesla = this;

  Object.keys(views).forEach(function(view) {
    if(view === 'root') {
      this.views.root = views[view];
      return;
    }
   
    var self = this; 
    dust.helpers[view] = function(chunk, context, bodies, params) {
      this.views[view] = this.views[view] || { instances: {} };
      var instance = this.views[view].instances[params.id] || new views[view](this, params.id, view);
      
      if(!instance.e) {
        instance.e = O(instance.context);
        instance.e.on('change', this.render.bind(this));
      }
      
      this.views[view].instances[params.id] = instance;
      return instance.render.apply(instance, arguments);
    }.bind(this);

    dust.helpers.event = function(chunk, context, bodies, params) {
      return chunk.write('data-e="' + context.get('view') + ':' + context.get('id') + ':' + Object.keys(params).map(function(param) { return dust.helpers.tap(param, chunk, context) + ':' + dust.helpers.tap(params[param], chunk, context) }).join(':') + '"');
    };
  }.bind(this));
}

Tesla.prototype.route = function() {
  return this.router.apply(arguments);
};

Tesla.prototype.render = function() {
  this.views.root(this.context, function(err, out) {
    var newTree = tovdom(out);
    var patches = diff(this.tree, newTree);
    console.log("patches!!", patches);
    this.rootNode = patch(this.rootNode, patches);
    this.tree = newTree;
  }.bind(this));
};

Tesla.prototype.attachHandlers = function(patch) {
  Object.keys(patch).forEach(function(n) {
    var p = path[n].patch;
    if(p.dataset && p.dataset.e) {
      // attach event handler   
    }
  });
};

Tesla.prototype.start = function(node) {
  this.views.root(function(err, out) {
    this.tree = tovdom(out);
    console.log(this.tree);
    this.rootNode = createElement(this.tree);
    document.body.appendChild(this.rootNode);
  }.bind(this));
}

var tesla = new Tesla();
tesla.start();
window.tesla = tesla;
