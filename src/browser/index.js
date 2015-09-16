var page       = require('page'),
    views      = require('./views'),
    dust       = require('dustjs-linkedin'),
    diff       = require('virtual-dom/diff'),
    patch      = require('virtual-dom/patch'),
    tovdom     = require('to-virtual-dom'),
    createElement = require('virtual-dom/create-element'),
    virtualize = require('vdom-virtualize')
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
    var newTree = virtualize.fromHTML(out);
    this.attachHandlers(newTree);
    var patches = diff(this.tree, newTree);
    this.rootNode = patch(this.rootNode, patches);
    this.tree = newTree;
  }.bind(this));
};

function Hook(app, event) {
  this.app = app;
}

Hook.prototype.hook = function(el, prop) {
  var event = prop.split(':');
  var viewInstance = this.app.views[event[0]].instances[event[1]];
  this.listener = viewInstance[event[3]].bind(viewInstance);
  el.addEventListener(event[2], this.listener);
}

Hook.prototype.unhook = function(el, prop) {
  var event = prop.split(':');
  var viewInstance = this.app.views[event[0]].instances[event[1]];
  el.removeEventListener(event[2], this.listener);
}

Tesla.prototype.attachHandlers = function(tree) {
  var app = this;
  attachEvent(tree);

  function attachEvent(node) {
    if(node.properties && node.properties.dataset) {
      var dataE = node.properties.dataset['e'];
      if(dataE) {
        node.properties[dataE] = new Hook(app);
      }
    }
    
    for(var i = 0, children = node.children; children != undefined && i < children.length; i++) {
      attachEvent(children[i]);
    }
  }
};

Tesla.prototype.start = function(node) {
  this.views.root(function(err, out) {
    this.tree = tovdom(out);
    this.attachHandlers(this.tree);
    this.rootNode = createElement(this.tree);
    document.body.appendChild(this.rootNode);
  }.bind(this));
}

var tesla = new Tesla();
tesla.start();
window.tesla = tesla;
