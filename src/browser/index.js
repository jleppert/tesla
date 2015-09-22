var page       = require('page'),
    views      = require('./views'),
    dust       = require('dustjs-linkedin'),
    diff       = require('virtual-dom/diff'),
    patch      = require('virtual-dom/patch'),
    tovdom     = require('to-virtual-dom'),
    createElement = require('virtual-dom/create-element'),
    virtualize = require('vdom-virtualize')
    O          = require('observed'),
    work       = require('webworkify');

function Tesla() {
  this.router = page;
  this.views = {};
  
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
        instance.contextObserver = O(instance.context);
        instance.contextObserver.on('change', this.render.bind(this));
      }
      
      this.views[view].instances[params.id] = instance;
      return instance.render.apply(instance, arguments);
    }.bind(this);

    dust.helpers.event = function(chunk, context, bodies, params) {
      return chunk.write('data-e="' + context.get('view') + ':' + context.get('id') + ':' + Object.keys(params).map(function(param) { return dust.helpers.tap(param, chunk, context) + ':' + dust.helpers.tap(params[param], chunk, context) }).join(':') + '"');
    };
    dust.helpers.view = function(chunk, context, bodies, params) {
      var tag = dust.helpers.tap(params.tag, chunk, context) || 'div';
      var klass = dust.helpers.tap(params.class, chunk, context) || '';
      var id    = dust.helpers.tap(params.id, chunk, context) || '';
      chunk.write('<' + tag + ' id="' + id + '" data-v="' + context.get('view') + ':' + context.get('id') + '" class="' + klass + '">');
      chunk.render(bodies.block, context);
      return chunk.write('</' + tag + '>');
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

function Event(app) {
  this.app = app;
}

Event.prototype.hook = function(el, prop) {
  var event = prop.split(':');
  var viewInstance = this.app.views[event[0]].instances[event[1]];
  this.listener = viewInstance[event[3]].bind(viewInstance);
  el.addEventListener(event[2], this.listener);
}

Event.prototype.unhook = function(el, prop) {
  var event = prop.split(':');
  var viewInstance = this.app.views[event[0]].instances[event[1]];
  el.removeEventListener(event[2], this.listener);
}

function Container(app) {
  this.app = app;
}

Container.prototype.hook = function(el, prop) {
  var view = prop.split(':');
  var viewInstance = this.app.views[view[0]].instances[view[1]];
  viewInstance.el = el;
  viewInstance.emit('render');
}

Container.prototype.unhook = function(el, prop) {
  var view = prop.split(':');
  var viewInstance = this.app.views[view[0]].instances[view[1]];
  viewInstance.emit('destroy');
  delete viewInstance.el;
}

Tesla.prototype.attachHandlers = function(tree) {
  var app = this;
  attachEvent(tree);

  function attachEvent(node) {
    if(node.properties && node.properties.attributes) {
      var dataE = node.properties.attributes['data-e'];
      var view = node.properties.attributes['data-v'];
      if(dataE) {
        node.properties[dataE] = new Event(app);
      }
      if(view) {
        node.properties[view] = new Container(app);
      }
    }
    
    for(var i = 0, children = node.children; children != undefined && i < children.length; i++) {
      attachEvent(children[i]);
    }
  }
};

Tesla.prototype.start = function(node) {
  this.views.root(function(err, out) {
    this.tree = virtualize.fromHTML(out);
    this.attachHandlers(this.tree);
    this.rootNode = createElement(this.tree);
    document.body.appendChild(this.rootNode);
  }.bind(this));
}

var tesla = new Tesla();
tesla.start();
window.tesla = tesla;
