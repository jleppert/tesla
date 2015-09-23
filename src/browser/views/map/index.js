var template = require('./templates/index.dust');
var events   = require('eventemitter2').EventEmitter2;
var util     = require('util');
var mapboxgl = require('mapbox-gl');
var nextTick = require('next-tick');

mapboxgl.accessToken = 'pk.eyJ1IjoiamxlcHBlcnQiLCJhIjoicnNTY0UwQSJ9.RuTrPZfnMm04ti7_om4dmw';

function Map(app, id, view) {
  events.call(this);

  //app.route('/', this.render);
  
  this.context.id = id;
  this.context.view = view;

  this.on('render', function() {
    nextTick(function() {
      console.log('rendered!!');
    });
  });

  this.widgets = {
    mapbox: new MapboxWidget()
  };
}
util.inherits(Map, events);

function MapboxWidget() {};
MapboxWidget.prototype = {
  type: 'Widget',
  init: function() {
    var container = document.createElement('div');

    nextTick(function() {
      var map = new mapboxgl.Map({
        container: container,
        style: 'mapbox://styles/mapbox/satellite-v8',
        center: [-74.50, 40],
        zoom: 9
      });
    });

    return container;
  },

  update: function() {

  },

  destroy: function() {

  }
};

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
